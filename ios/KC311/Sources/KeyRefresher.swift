import Compression
import Foundation

/// Keeps the API signing key current without a computer.
///
/// The city's Android app signs each request with a key that ships inside
/// the APK, and an app update can change it. When the server rejects the
/// signature (or the app has no key yet), this downloads the newest APK from
/// APKPure, unzips its code files, and scans them for strings with the shape
/// of the key (44 base64 characters), the city id (32 hex characters), and
/// the app version (2025.020). It keeps the first combination that the server
/// accepts and saves it, so a stale key is replaced in about a minute.
@MainActor
final class KeyRefresher: ObservableObject {
    static let shared = KeyRefresher()
    nonisolated static let package = "com.civicapps.kansascitymo"
    nonisolated static let kansasCity = "1adb57d07d9ea1e1dd8160697f745c0d"

    enum State: Equatable { case idle, downloading(Double), scanning, testing, done(String), failed(String) }
    @Published var state: State = .idle
    var isBusy: Bool {
        switch state { case .downloading, .scanning, .testing: true; default: false }
    }
    private var running: Task<Bool, Never>?

    nonisolated static var savedURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("civic-config.json")
    }

    /// Automatic refreshes run at most once in this many seconds, so a server
    /// that keeps refusing cannot make the app download 44 MB again and again.
    static let autoInterval: TimeInterval = 6 * 3600
    var lastAuto: Date? {
        get { UserDefaults.standard.object(forKey: "keyAutoAttempt") as? Date }
        set { UserDefaults.standard.set(newValue, forKey: "keyAutoAttempt") }
    }

    /// Runs one refresh at a time; concurrent callers share the result.
    /// `manual` skips the 6-hour limit (the Settings button).
    @discardableResult
    func refresh(manual: Bool = false) async -> Bool {
        if let running { return await running.value }
        if !manual, CivicConfig.current != nil, let last = lastAuto, Date().timeIntervalSince(last) < Self.autoInterval {
            return false
        }
        if !manual { lastAuto = Date() }
        let t = Task { await run() }
        running = t
        let ok = await t.value
        running = nil
        return ok
    }

    private func run() async -> Bool {
        do {
            state = .downloading(0)
            let apk = try await downloadAPK()
            state = .scanning
            let found = try Self.scan(apk)
            state = .testing
            for key in found.keys {
                for version in found.versions.isEmpty ? ["2025.020"] : found.versions {
                    for city in [Self.kansasCity] + found.cities where !city.isEmpty {
                        let cfg = CivicConfig(key: key, city_id: city, app_version: version, device_uid: CivicClient.shared.deviceUID)
                        if await CivicClient.shared.accepts(cfg) {
                            try FileManager.default.createDirectory(at: Self.savedURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                            try JSONEncoder().encode(cfg).write(to: Self.savedURL)
                            CivicConfig.reload()
                            UserDefaults.standard.set(Date(), forKey: "keyRefreshed")
                            state = .done(version)
                            return true
                        }
                    }
                }
            }
            state = .failed("The new app's key was not accepted. The city may have changed how requests are signed.")
        } catch {
            state = .failed(error.localizedDescription)
        }
        return false
    }

    // MARK: Download

    private func downloadAPK() async throws -> Data {
        var req = URLRequest(url: URL(string: "https://api.pureapk.com/m/v3/cms/app_version?hl=en-US&package_name=\(Self.package)")!)
        for (k, v) in ["x-cv": "3172501", "x-sv": "29", "x-abis": "arm64-v8a,armeabi-v7a,armeabi,x86,x86_64", "x-gp": "1"] {
            req.setValue(v, forHTTPHeaderField: k)
        }
        let (meta, _) = try await URLSession.shared.data(for: req)
        // The reply is protobuf; the APK link follows an "APKJ" marker and two
        // bytes (an "XAPKJ" marker means a split APK in a zip). Same pattern as
        // apkeep's APKPure source.
        let text = String(decoding: meta, as: UTF8.self)
        let re = try NSRegularExpression(pattern: #"APKJ.{1,4}?(https?://[-a-zA-Z0-9@:%._+~#=/?&()]+)"#)
        guard let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let r = Range(m.range(at: 1), in: text), let url = URL(string: String(text[r])) else {
            throw CivicError.server("Could not find the city app's download.")
        }
        let progress = DownloadProgress { [weak self] f in Task { @MainActor in self?.state = .downloading(f) } }
        let (file, _) = try await URLSession.shared.download(from: url, delegate: progress)
        defer { try? FileManager.default.removeItem(at: file) }
        return try Data(contentsOf: file, options: .mappedIfSafe)
    }

    // MARK: Scan

    struct Found { var keys: [String] = []; var cities: [String] = []; var versions: [String] = [] }

    nonisolated static func scan(_ apk: Data) throws -> Found {
        var found = Found()
        var keys = Set<String>(), cities = Set<String>(), versions = Set<String>()
        var files = try Zip.entries(in: apk, suffix: ".dex")
        if files.isEmpty {
            // An XAPK is a zip of split APKs; the code is in the base APK.
            for (_, inner) in try Zip.entries(in: apk, suffix: ".apk") { files += try Zip.entries(in: inner, suffix: ".dex") }
        }
        for (name, dex) in files where name.range(of: #"^classes\d*\.dex$"#, options: .regularExpression) != nil {
            let s = String(decoding: dex, as: UTF8.self)
            keys.formUnion(matches(#"(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{43}=(?![A-Za-z0-9+/=])"#, in: s))
            cities.formUnion(matches(#"(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])"#, in: s))
            versions.formUnion(matches(#"(?<![0-9.])20\d\d\.\d{3}(?![0-9.])"#, in: s))
        }
        found.keys = keys.sorted()
        found.cities = cities.sorted()
        found.versions = versions.sorted(by: >)
        return found
    }

    nonisolated private static func matches(_ pattern: String, in s: String) -> [String] {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return [] }
        return re.matches(in: s, range: NSRange(s.startIndex..., in: s)).compactMap { Range($0.range, in: s).map { String(s[$0]) } }
    }
}

extension Zip {
    /// Reads a ZIP (an APK) from its central directory. Stored and deflated
    /// entries only, which is all an APK uses.
    static func entries(in z: Data, suffix: String) throws -> [(String, Data)] {
        func u16(_ o: Int) -> Int { Int(z[z.startIndex + o]) | Int(z[z.startIndex + o + 1]) << 8 }
        func u32(_ o: Int) -> Int { u16(o) | u16(o + 2) << 16 }
        guard z.count > 22 else { throw CivicError.server("The download is not a zip file.") }
        var eocd = z.count - 22
        while eocd > max(0, z.count - 66_000), u32(eocd) != 0x0605_4B50 { eocd -= 1 }
        guard u32(eocd) == 0x0605_4B50 else { throw CivicError.server("The download is not a zip file.") }
        let count = u16(eocd + 10)
        var p = u32(eocd + 16)
        var out: [(String, Data)] = []
        for _ in 0..<count {
            guard u32(p) == 0x0201_4B50 else { break }
            let method = u16(p + 10), csize = u32(p + 20), usize = u32(p + 24)
            let nlen = u16(p + 28), elen = u16(p + 30), clen = u16(p + 32), local = u32(p + 42)
            let name = String(decoding: z[(z.startIndex + p + 46)..<(z.startIndex + p + 46 + nlen)], as: UTF8.self)
            p += 46 + nlen + elen + clen
            guard name.hasSuffix(suffix) else { continue }
            let start = local + 30 + u16(local + 26) + u16(local + 28)
            let body = z[(z.startIndex + start)..<(z.startIndex + start + csize)]
            if method == 0 { out.append((name, Data(body))) }
            else if method == 8, let d = inflate(Data(body), size: usize) { out.append((name, d)) }
        }
        return out
    }

    private static func inflate(_ src: Data, size: Int) -> Data? {
        var dst = Data(count: size)
        let n = dst.withUnsafeMutableBytes { d in
            src.withUnsafeBytes { s in
                compression_decode_buffer(d.bindMemory(to: UInt8.self).baseAddress!, size,
                                          s.bindMemory(to: UInt8.self).baseAddress!, src.count, nil, COMPRESSION_ZLIB)
            }
        }
        return n == size ? dst : nil
    }
}

/// Reports download progress from URLSession's task delegate.
final class DownloadProgress: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    let report: (Double) -> Void
    private var last = 0.0
    init(_ report: @escaping (Double) -> Void) { self.report = report }

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0 else { return }
        let f = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
        if f - last >= 0.02 || f >= 1 { last = f; report(f) }
    }

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {}
}

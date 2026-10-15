import CryptoKit
import Foundation
import Security

/// Transport for the MyCivic mobile API (api.mycivicapps.com/api/v3), the
/// backend of the official myKCMO app. Each request carries an `ApiSignature`
/// HS256 JWT signed with the city app's key. When the app has no key, or the
/// server rejects the signature because the city shipped a new key,
/// KeyRefresher gets the current key from the newest APK and the request is
/// sent once more.
struct CivicConfig: Codable, Equatable {
    let key: String
    let city_id: String
    let app_version: String
    var device_uid: String?

    /// A key saved by KeyRefresher wins over one built into the app.
    private(set) static var current: CivicConfig? = load()

    static func reload() { current = load() }

    private static func load() -> CivicConfig? {
        if let d = try? Data(contentsOf: KeyRefresher.savedURL), let c = try? JSONDecoder().decode(CivicConfig.self, from: d) {
            return c
        }
        guard let url = Bundle.main.url(forResource: "CivicConfig", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(CivicConfig.self, from: data)
    }
}

enum CivicError: LocalizedError {
    case noConfig
    case keyRotated
    /// The server refused the request for a reason other than the key
    /// (a moved base URL, a changed token rule).
    case rejected(String)
    case server(String)
    case offline

    var errorDescription: String? {
        switch self {
        case .noConfig: "The app has no API key yet, and getting one did not work. Check the connection and try again."
        case .keyRotated: "The city changed its app's API key, and the app could not get the new one. Try again from the City tab."
        case .rejected(let msg): "The city's server refused the request" + (msg.isEmpty ? "." : ": \(msg)")
        case .server(let msg): msg.isEmpty ? "The city's server returned an error." : msg
        case .offline: "No connection to the city's server."
        }
    }
}

final class CivicClient {
    static let shared = CivicClient()
    static let defaultBase = URL(string: "https://api.mycivicapps.com/api/v3/")!
    /// The API base. The city's server names it in get_baseurl; the official
    /// app asks again after a 403, and so does APIHealth.
    static var base: URL {
        get { UserDefaults.standard.url(forKey: "apiBase") ?? defaultBase }
        set { UserDefaults.standard.set(newValue, forKey: "apiBase") }
    }
    static let apiVersion = "6.0"

    /// No cookies. The server sets a session cookie, and it handles one
    /// session's requests one at a time, so with cookies the parallel map
    /// calls ran in a queue (about 6 s each, one after another).
    let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieAcceptPolicy = .never
        c.httpShouldSetCookies = false
        c.httpMaximumConnectionsPerHost = 12
        c.timeoutIntervalForRequest = 90
        return URLSession(configuration: c)
    }()

    /// The id the city files "my reports" under. KCMO has no accounts, so
    /// losing this id loses the list. It is kept in the iCloud Keychain as
    /// well as UserDefaults: the Keychain copy survives deleting the app and
    /// follows the Apple ID to a new phone.
    private(set) var deviceUID: String

    private init() {
        // Keychain first, then UserDefaults, then a bundled id (personal
        // builds only; scripts/testflight.sh never bundles one), else new.
        let stored = DeviceIDStore.read() ?? UserDefaults.standard.string(forKey: "deviceUID") ?? CivicConfig.current?.device_uid
        if let stored, !stored.isEmpty {
            deviceUID = stored
        } else {
            deviceUID = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(16))
        }
        UserDefaults.standard.set(deviceUID, forKey: "deviceUID")
        DeviceIDStore.write(deviceUID)
    }

    /// Switch to another device id (Settings > Restore my reports). The id
    /// is 16 lowercase hex characters.
    @discardableResult
    func useDeviceUID(_ raw: String) -> Bool {
        let id = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard id.range(of: "^[0-9a-f]{16}$", options: .regularExpression) != nil else { return false }
        deviceUID = id
        UserDefaults.standard.set(id, forKey: "deviceUID")
        DeviceIDStore.write(id)
        return true
    }

    private func b64(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    func signature(_ cfg: CivicConfig) throws -> String {
        let nonce = (0..<16).map { _ in String("abcdefghijklmnopqrstuvwxyz0123456789".randomElement()!) }.joined()
        let claims: [String: String] = [
            "city_id": cfg.city_id, "deviceuid": deviceUID, "APPTYPE": "CITY",
            "app_version": cfg.app_version, "device_type": "android",
            "APIVERSION": Self.apiVersion, "nounce": nonce,
        ]
        let header = b64(try JSONSerialization.data(withJSONObject: ["alg": "HS256"]))
        let payload = b64(try JSONSerialization.data(withJSONObject: claims))
        let key = SymmetricKey(data: Data(cfg.key.utf8))
        let mac = HMAC<SHA256>.authenticationCode(for: Data("\(header).\(payload)".utf8), using: key)
        return "\(header).\(payload).\(b64(Data(mac)))"
    }

    /// Fields the Android app sends with almost every call.
    func baseFields(_ cfg: CivicConfig) -> [String: String] {
        ["city_id": cfg.city_id, "api_version": Self.apiVersion, "device_id": deviceUID,
         "deviceuid": deviceUID, "app_type": "1", "language": "en"]
    }

    struct FilePart { let name: String; let filename: String; let data: Data; let mime: String }

    /// POST a multipart request and return the decoded JSON object.
    func post(_ endpoint: String, fields: [String: String] = [:], files: [FilePart] = [],
              includeBase: Bool = true) async throws -> [String: Any] {
        do {
            return try await send(endpoint, fields: fields, files: files, includeBase: includeBase, cfg: CivicConfig.current)
        } catch let e as CivicError where e.isAuthFailure {
            // The API broke for this app: repair it (base URL, then key), then try once more.
            guard await APIHealth.shared.repair(after: e) else { throw e }
            return try await send(endpoint, fields: fields, files: files, includeBase: includeBase, cfg: CivicConfig.current)
        }
    }

    /// True when the server accepts a signed read with this config.
    func accepts(_ cfg: CivicConfig) async -> Bool {
        guard let obj = try? await send("get_main", fields: ["timestamp": "0"], files: [], includeBase: true, cfg: cfg) else { return false }
        return ((obj["response_status"] as? [String: Any])?["response_code"] as? Int) == 1
    }

    private func send(_ endpoint: String, fields: [String: String], files: [FilePart],
                      includeBase: Bool, cfg: CivicConfig?) async throws -> [String: Any] {
        guard let cfg else { throw CivicError.noConfig }
        let boundary = "----kc311" + UUID().uuidString
        var body = Data()
        let all = includeBase ? baseFields(cfg).merging(fields) { _, new in new } : fields
        for (k, v) in all {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(k)\"\r\n\r\n\(v)\r\n".data(using: .utf8)!)
        }
        for f in files {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(f.name)\"; filename=\"\(f.filename)\"\r\nContent-Type: \(f.mime)\r\n\r\n".data(using: .utf8)!)
            body.append(f.data)
            body.append("\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        var req = URLRequest(url: Self.base.appendingPathComponent(endpoint))
        req.httpMethod = "POST"
        req.timeoutInterval = 90
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.setValue("okhttp/4.9.0", forHTTPHeaderField: "User-Agent")
        req.setValue(try signature(cfg), forHTTPHeaderField: "ApiSignature")
        req.httpBody = body

        let data: Data
        do { (data, _) = try await session.data(for: req) } catch { throw CivicError.offline }
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CivicError.server("Unreadable reply from the city's server.")
        }
        // A bad signature shows up as 403 or as response_code 1 with an
        // "Invalid API Signature" token message, so check the message first.
        // "kindly update the app" means the server wants a newer app version,
        // which also comes from the newest APK.
        let tokenMessage = obj["response_token_message"] as? String ?? ""
        if tokenMessage.contains("Signature") || tokenMessage.lowercased().contains("update the app") {
            throw CivicError.keyRotated
        }
        if (obj["response_code"] as? Int) == 403 { throw CivicError.rejected(tokenMessage) }
        return obj
    }

    /// Asks the server for the current API base, like the official app.
    func refreshBase() async -> Bool {
        guard let cfg = CivicConfig.current else { return false }
        let json = "{\"city_id\":\"\(cfg.city_id)\",\"api_version\":\"\(Self.apiVersion)\",\"deviceuid\":\"\(deviceUID)\",\"app_type\":\"CITY\"}"
        let boundary = "----kc311" + UUID().uuidString
        var req = URLRequest(url: URL(string: "https://api.mycivicapps.com/token/get_baseurl")!)
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.setValue("okhttp/4.9.0", forHTTPHeaderField: "User-Agent")
        req.setValue(try? signature(cfg), forHTTPHeaderField: "ApiSignature")
        req.httpBody = "--\(boundary)\r\nContent-Disposition: form-data; name=\"POST_JSON\"\r\n\r\n\(json)\r\n--\(boundary)--\r\n".data(using: .utf8)
        guard let (data, _) = try? await session.data(for: req),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let main = (obj["response_data"] as? [String: Any])?["maindomainurl"] as? String,
              let url = URL(string: main.hasSuffix("/") ? main : main + "/") else { return false }
        let changed = url != Self.base
        Self.base = url
        return changed
    }

    /// POST with the body as one POST_JSON part (the app's other style).
    func postJSON(_ endpoint: String, payload: [String: Any], files: [FilePart] = []) async throws -> [String: Any] {
        let city = CivicConfig.current?.city_id ?? KeyRefresher.kansasCity
        var full: [String: Any] = ["city_id": city, "api_version": Self.apiVersion, "deviceuid": deviceUID]
        full.merge(payload) { _, new in new }
        let json = String(data: try JSONSerialization.data(withJSONObject: full), encoding: .utf8)!
        return try await post(endpoint, fields: ["POST_JSON": json], files: files, includeBase: false)
    }
}

extension CivicError {
    /// Failures that a new key or base URL can fix. A server outage or a dead
    /// connection is not one of them, so it never starts a key download.
    var isAuthFailure: Bool {
        switch self { case .keyRotated, .noConfig, .rejected: true; default: false }
    }
}


/// The device id in the Keychain, synced through iCloud Keychain.
enum DeviceIDStore {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "kc311.deviceUID",
        kSecAttrAccount as String: "deviceUID",
        kSecAttrSynchronizable as String: kCFBooleanTrue!,
    ]

    static func read() -> String? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func write(_ id: String) {
        let data = Data(id.utf8)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            SecItemAdd(add as CFDictionary, nil)
        }
    }
}

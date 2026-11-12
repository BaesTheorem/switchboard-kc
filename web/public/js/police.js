// Police reports: what the Kansas City Police Department takes online, and how
// to get a copy of a report. The department is not part of 311. Its online
// form and its report requests run at LexisNexis (secure.coplogic.com).
//
// Every name, rule, number and address here is from the department's own
// pages on www.kcpolice.org, read on 2026-11-12:
//   /crime/make-a-police-report-online/ and its FAQ page
//   /about/services/report-and-video-requests/
// The city's app links to the same form through www.kcpd.org, a host whose
// certificate expired on 2026-10-17. This app does not use that address.

export const POLICE_READ = "November 12, 2026";
export const POLICE_PAGE = "https://www.kcpolice.org/crime/make-a-police-report-online/";
export const STATIONS_PAGE = "https://www.kcpolice.org/contact-us/patrol-division-stations/";
export const NON_EMERGENCY = "816-234-5111";
const FORM = "https://secure.coplogic.com/dors/startreport/300005194/";

/**
 * The reports the department takes online, in its order and with its names.
 * `form` is the number of the department's form for the type. `suspect`: the
 * department accepts this type when the person knows who did it.
 */
export const POLICE_TYPES = [
  { name: "Accident: hit and run", form: 300010003 },
  { name: "Accident: no injury", form: 300010004 },
  { name: "Child custody violation", form: 300010005, suspect: true },
  { name: "Drug activity tip", form: 300010006, suspect: true },
  { name: "Extra patrol request", form: 300010007 },
  { name: "Fraudulent use of a credit device", form: 300010008 },
  { name: "Identity theft", form: 300010009 },
  { name: "Lost property", form: 300010010 },
  { name: "Phone harassment", form: 300010011 },
  { name: "Property or vehicle damage", form: 300010012 },
  { name: "Shoplifting (loss under $2,000)", form: 300010013, suspect: true },
  { name: "Theft (value under $2,000)", form: 300010014 },
  // Not a form at LexisNexis: the department takes these on a page of its own, in English.
  { name: "Traffic complaint", url: "https://www.kcpolice.org/crime/prevention-and-safety-tips/traffic-complaints/", suspect: true },
];

/** The address of the department's form for a type, in Spanish where it has one. */
export const policeFormUrl = (t, spanish = false) => (t.form ? `${FORM}${t.form}${spanish ? "/es" : ""}` : t.url);

/** The department's conditions for an online report. All of them must be true. */
export const POLICE_RULES = [
  "It happened inside Kansas City, Missouri.",
  "No one was injured.",
  "You were not the victim of a hate crime.",
  "No firearm was involved.",
  "Your car or your license plate was not stolen.",
  "You do not know who did it, where to find them, or their license plate. Four report types below accept this.",
];

/** A copy of a report: the Criminal Records Section. */
export const RECORDS = {
  phone: "816-234-5100",
  hours: "Monday to Friday, 8 a.m. to 2 p.m.",
  request: "https://secure.coplogic.com/rar/startrequest/200000962/",
  crash: "https://www.kcpolice.org/about/services/report-and-video-requests/online-crash-reports/",
  fees: "https://www.kcpolice.org/about/services/report-and-video-requests/fees-for-records/",
  mail: ["Kansas City Missouri Police Department", "Attn: Criminal Records Section", "1125 Locust", "Kansas City, MO 64106"],
};

/** True for the city's menu link to the police report page, which this app answers with its own screen. */
export const isPoliceLink = (l) => /police report/i.test(String(l?.name || ""));

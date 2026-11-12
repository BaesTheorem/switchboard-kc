// Paying the city: each bill, ticket and fee, with the address of the payment
// page of the office that owns it. The app takes no card numbers and keeps no
// account numbers: it opens the office's own page.
//
// From the city's Pay Online page (kcmo.gov/city-hall/pay-online), read on
// 2026-11-12. Every address here answered on that day. The city's app has
// one menu link to that page; this list puts each payment one tap away.

export const PAY_READ = "November 12, 2026";
export const PAY_PAGE = "https://www.kcmo.gov/city-hall/pay-online";

const COLLECTOR = "https://magic.collectorsolutions.com/magic-ui/Login/mo_kansas_city_2016";

/** In the order a resident meets them most. `phone` is a second way to pay. */
export const PAYMENTS = [
  { name: "Water bill", icon: "water_drop", url: "https://my.kcwater.us/eportal/#/accountlookup/pay",
    note: "KC Water. Or by phone at all hours: 816-513-0567.", phone: "816-513-0567" },
  { name: "Parking ticket", icon: "local_parking", url: "https://parkkcmo.com/",
    note: "ParkKC, for a ticket from November 1, 2022 or later. An older ticket goes to Municipal Court." },
  { name: "Court ticket or fine", icon: "balance", url: "https://www.kcmo.gov/city-hall/departments/municipal-court/fines-payments-and-sentences",
    note: "Municipal Court. You can ask for a payment plan, or for community service at your court date." },
  { name: "City taxes", icon: "description", url: "https://quicktax.kcmo.org/kcp/tap/_/",
    note: "Quick Tax: returns and payments for every city tax." },
  { name: "Ambulance bill", icon: "emergency", url: COLLECTOR,
    note: "Have the account number from your statement." },
  { name: "Permit or license fee", icon: "architecture", url: "https://compasskc.kcmo.org/",
    note: "Compass KC: plans, permits and licenses." },
  { name: "Pet license", icon: "pets", url: "https://www.petdata.com/for-pet-owners/kcm/", note: "" },
  { name: "Rent for leased city property", icon: "home_work", url: COLLECTOR,
    note: "The payment company adds a fee." },
  { name: "Health Department fees", icon: "health_and_safety", url: "https://city.kcmo.org/kc/AirQualityProgram/EnvironProgram.aspx",
    note: "Environmental services fees. Other health payments are in person at 2400 Troost." },
  { name: "Parks passes and classes", icon: "park", url: "https://www.kcparks.org/", note: "" },
  { name: "Dumpster rental", icon: "delete_sweep", url: "https://city.kcmo.org/kc/NeighborhoodDumpsterProgram/", note: "" },
  { name: "Land Bank", icon: "apartment", url: "https://public-kclb.epropertyplus.com/", note: "" },
];

/** What the city takes in person only, or also in person. */
export const IN_PERSON = [
  "Towing fees: only in person, at the Tow Lot, 7750 E. Front St. A money order, a debit card or a credit card. No cash. Tow Services: 816-513-0688.",
  "Taxes and water bills: also at City Hall, 414 E. 12th St. Water bills also at 4800 E. 63rd St.",
];

/** True for the city's menu link to its Pay Online page, which this app answers with its own screen. */
export const isPayLink = (l) => /^pay online$/i.test(String(l?.name || "").trim());

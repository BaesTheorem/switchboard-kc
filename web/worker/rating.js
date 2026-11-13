// The rating of a closed report (rai_report_rating, docs/API.md section 9).
// The rules here are from the city's Android app (FeedbackNoteFragment and
// MyReportRowViewHolder, read 2026-11-12): five stars with the values 1 to 5,
// a rating only for a report with the status "resolved" or "close", and one
// rating for each report.

/** The star values the city's app sends. */
export const STARS = [1, 2, 3, 4, 5];

/** True when the status of a `myissues` row is one that the city's app lets a person rate. */
export const isClosedForRating = (status) => /^(resolved|closed?)$/i.test(String(status ?? "").trim());

/** True when the city says that this row has no rating yet. A row with no `hasRated` field gives false. */
export const notRated = (row) => String(row?.hasRated ?? "").trim().toLowerCase() === "no";

/** Why this `myissues` row cannot get a rating, or "" when it can. */
export function ratingBlock(row) {
  if (!row) return "not_yours";
  if (!isClosedForRating(row.status)) return "not_closed";
  if (!notRated(row)) return "rated";
  return "";
}

/**
 * The `rating_details` object, with the keys in the order of the city's app.
 * `row` is the report's `myissues` row: the city names the report by its
 * `city_report_id`. The contact keys of the city's app are left out. The
 * report has the contact details that the person gave when they filed it.
 */
export function ratingDetails(cityId, apiVersion, uid, row, rating, notes) {
  return {
    city_id: cityId,
    device_id: uid,
    deviceuid: uid,
    rating: String(rating),
    report_id: String(row.city_report_id || row.id),
    notes: String(notes || ""),
    api_version: apiVersion,
  };
}

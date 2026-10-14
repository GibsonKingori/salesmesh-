// What to show the user for a Supabase error: "TypeError: fetch failed" means the server couldn't
// reach the database at all (see config/supabaseClient.js), which says nothing useful as it is
export const dbErrorMessage = (error) =>
  /fetch failed/i.test(error?.message || '')
    ? "Couldn't reach the database. Check the server's internet connection and try again."
    : error?.message;

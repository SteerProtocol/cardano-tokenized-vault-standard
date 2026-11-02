/** GET-only capability for this example, not a production HTTP policy. */
export async function get(url) {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });

    return { status: response.status, body: await response.text() };
  } catch {
    // JCO maps a thrown string to this import's WIT result error.
    throw "fetch-failed";
  }
}

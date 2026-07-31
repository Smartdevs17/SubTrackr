# Inserted into vcl_fetch (type=fetch snippet)
if (beresp.http.Cache-Control ~ "s-maxage=") {
  set beresp.ttl = std.atoi(regsub(beresp.http.Cache-Control, ".*s-maxage=([0-9]+).*", "\1"));
}

if (beresp.http.Cache-Control ~ "stale-while-revalidate=") {
  set beresp.stale_while_revalidate = std.atoi(
    regsub(beresp.http.Cache-Control, ".*stale-while-revalidate=([0-9]+).*", "\1")
  );
}

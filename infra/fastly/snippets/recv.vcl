# Inserted into vcl_recv (type=recv snippet)
if (req.method == "GET" && (
  req.url ~ "^/plans/?(\\?.*)?$" ||
  req.url ~ "^/pricing/?(\\?.*)?$" ||
  req.url ~ "^/features/?(\\?.*)?$" ||
  req.url ~ "^/public(/.*)?(\\?.*)?$"
)) {
  return (lookup);
}

// Resolve the remembered-agent redirect on the server. Query-bearing launches
// and redirects with cookie changes retain their ordinary browser semantics.
export async function followStartupRedirect(
  request: Request,
  response: Response,
  render: (request: Request) => Response | Promise<Response>,
): Promise<Response> {
  const source = new URL(request.url);
  const location = response.headers.get("Location");
  if (
    !["GET", "HEAD"].includes(request.method) ||
    source.pathname !== "/" ||
    source.search ||
    response.status !== 307 ||
    !location ||
    response.headers.has("Set-Cookie")
  )
    return response;

  const target = new URL(location, source);
  if (
    target.origin !== source.origin ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    !/^\/agents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      target.pathname,
    )
  )
    return response;

  await response.body?.cancel();
  return render(new Request(target, request));
}

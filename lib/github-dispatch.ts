export type DispatchPayload = Record<string, unknown> | undefined;

export const sendRepositoryDispatch = async (
  eventType: string,
  clientPayload?: DispatchPayload,
): Promise<boolean> => {
  const token = process.env.GITHUB_DISPATCH_TOKEN?.trim();
  const repo = process.env.GITHUB_REPO_SLUG?.trim(); // format: owner/repo

  if (!token || !repo) {
    return false;
  }

  const resp = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: eventType,
      client_payload: clientPayload ?? {},
    }),
  });

  return resp.ok;
};


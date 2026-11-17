// The own-team gate: may the login act for the viewed team? Offers, alerts,
// waiver claims, Refresh and the dashboard's notices all ask this one question.
//   'own'       the login owns or co-owns the viewed team
//   'viewingAs' the viewed team is someone else's
//   'loggedOut' no Sleeper login in this Chrome

export function ownTeam(viewed, login) {
  if (!login || !login.userId) return 'loggedOut';
  const id = String(login.userId);
  const r = ((viewed && viewed.rosters) || []).find((x) => String(x.roster_id) === String(viewed.rosterId));
  const owners = r ? [r.owner_id, ...(r.co_owners || [])].filter((x) => x != null).map(String) : [];
  return owners.includes(id) ? 'own' : 'viewingAs';
}

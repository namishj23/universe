// Gender-preference rules, shared by matching, joining, the Dashboard list and
// driver assignment so every screen applies exactly the same logic.
//
// Profile fields (rides_profiles; all optional, a student who sets nothing pools with everyone):
//   gender:           'female' | 'male' | 'non_binary' | null (prefer not to say)
//   womenOnlyGroups:  true -> only see/join women-only groups (female students only)
//   driverPreference: 'any' | 'female'
// Group field:
//   womenOnly: set when the group is started by a student with womenOnlyGroups on.
//
// Privacy: a student's gender is only ever read here. It's never put in any group,
// member or match payload - other students only see a group's "women-only" label.

const GENDERS = ['female', 'male', 'non_binary'];
const DRIVER_PREFERENCES = ['any', 'female'];

const isFemale = (user) => user?.gender === 'female';
const wantsWomenOnly = (user) => isFemale(user) && Boolean(user.womenOnlyGroups);
const wantsFemaleDriver = (user) => user?.driverPreference === 'female';

/**
 * Can `user` see / join group `g`? Hard filter:
 *   - a women-only group is closed to anyone not female, no exceptions;
 *   - a student who asked for women-only groups doesn't see other groups unless
 *     they chose "show other groups for this ride" (relax = true).
 * @returns {{ ok: true } | { ok: false, reason: 'women_only_group' | 'not_women_only' }}
 */
function groupAccess(user, g, { relax = false } = {}) {
  if (g.womenOnly && !isFemale(user)) return { ok: false, reason: 'women_only_group' };
  if (wantsWomenOnly(user) && !g.womenOnly && !relax)
    return { ok: false, reason: 'not_women_only' };
  return { ok: true };
}

const accessMessage = (reason) =>
  reason === 'women_only_group'
    ? 'This is a women-only group.'
    : 'This group isn\'t women-only. Choose "show other groups for this ride" to join it anyway.';

/**
 * Does this group's driver have to be female? The strictest member wins:
 *   - women-only group -> always (cannot be waived);
 *   - any member with driver_preference 'female' who hasn't waived it for this group.
 * @param {object} g             group row (womenOnly)
 * @param {Array}  memberPrefs   [{ userId, user, allowAnyDriver }]
 * @returns {{ female: boolean, womenOnly: boolean, requestedBy: string[] }}
 */
function driverRequirement(g, memberPrefs) {
  const requestedBy = memberPrefs
    .filter((m) => wantsFemaleDriver(m.user) && !m.allowAnyDriver)
    .map((m) => m.userId);
  return {
    female: Boolean(g.womenOnly) || requestedBy.length > 0,
    womenOnly: Boolean(g.womenOnly),
    requestedBy,
  };
}

module.exports = {
  GENDERS,
  DRIVER_PREFERENCES,
  isFemale,
  wantsWomenOnly,
  wantsFemaleDriver,
  groupAccess,
  accessMessage,
  driverRequirement,
};

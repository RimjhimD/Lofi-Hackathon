# Permissions — Relief Lens v2

Who can do what, and which policy in `schema.sql` is the reason. "Approved"
means `profiles.approved = true`; an authenticated user who isn't approved yet
gets exactly the public tier — a fresh volunteer signup and an anonymous
visitor see the same thing until an admin flips the switch.

## Capability matrix

| Capability | Public | Volunteer | Commissioner | Admin |
|---|---|---|---|---|
| View map (shelter location, capacity, headcount) | ✅ | ✅ | ✅ | ✅ |
| View needs / shortage data (shelter_needs, updates, consignments) | ❌ | ✅ (once approved) | ✅ (once approved) | ✅ (once approved) |
| Submit field update (headcount, needs, note) | ❌ | ✅ (once approved) | ✅ (once approved) | ✅ (once approved) |
| Import consignments (CSV → rows) | ❌ | ❌ | ✅ (once approved) | ✅ (once approved) |
| Manage shelters (create/edit/delete) | ❌ | ❌ | ❌ | ✅ |
| Manage accounts (set role, set approved) | ❌ | ❌ | ❌ | ✅ |

Volunteer and Commissioner columns assume `approved = true`. Before that,
every row in those two columns is a flat ❌ — RLS gates on `is_approved()`
regardless of role, not on role alone.

## How RLS enforces it

**View map.** `shelters_select_public` — `for select to public using (true)`.
`public` covers `anon` and `authenticated` both, which is why this is the one
row where an unapproved or logged-out visitor still gets a yes. `shelters`
holds only location/capacity/headcount; needs data lives in a separate table
that this policy does not touch.

**View needs / shortage data.** Three read policies, same shape:
`shelter_needs_select_approved`, `updates_select_approved`,
`consignments_select_approved` — each `for select to authenticated using
(is_approved())`. The item catalogue itself (`supply_items`) is public via
`supply_items_select_public`, since the 8 fixed items/units carry nothing
sensitive and the dropdown needs to render before login.

**Submit field update.** `updates_insert_field_team` — `for insert to
authenticated with check (author = auth.uid() and is_approved() and
app_role() in ('volunteer','commissioner','admin'))`. The role list is every
role there is, so in practice this is "any approved account may file a field
update" — spelled out explicitly rather than left implicit. `author =
auth.uid()` in the `WITH CHECK` is what "author forced" means here: a client
can omit `author` (the column default fills in `auth.uid()`) but cannot set
it to someone else's id and have the insert succeed. The insert itself is
the only path that changes `shelters.headcount` and replaces
`shelter_needs` for that shelter — `apply_field_update_trigger`
(`SECURITY DEFINER`) does that write after the insert commits, so a
volunteer's session never touches `shelters` or `shelter_needs` with its own
grants.

**Import consignments.** `consignments_insert_commissioner_admin` — same
shape as the update-insert policy, restricted to `app_role() in
('commissioner','admin')`, with `created_by = auth.uid()` enforced the same
way as `author` above. Both `updates` and `consignments` are append-only:
neither table has an `UPDATE` or `DELETE` policy, so a correction is a new
row, not an edit to history.

**Manage shelters.** `shelters_insert_admin`, `shelters_update_admin`,
`shelters_delete_admin` — all three `to authenticated` gated on `app_role() =
'admin'`. This is genuine direct `UPDATE` access to `shelters`, distinct from
the trigger-driven headcount bump above; it's how an admin adds a new
shelter or fixes a typo in a name/location.

**Manage accounts.** `profiles_select_admin` and `profiles_update_admin`
give an admin read/write on every profile row, gated the same way
(`app_role() = 'admin'`). Every other authenticated user only gets
`profiles_select_own` / `profiles_update_own` — their own row, and
`guard_profile_privileges_trigger` (a `BEFORE UPDATE` trigger, not an RLS
policy) blocks even that from touching `role` or `approved` unless the
caller's own `app_role()` is already `admin`. That split — RLS decides *which
row*, the trigger decides *which column* — is why `profiles_update_own` can
stay a simple "own row" policy instead of needing per-column logic that
Postgres RLS doesn't support natively.

**Signup default.** `on_auth_user_created` (`AFTER INSERT ON auth.users`)
creates the profile row with `role = 'volunteer'`, `approved = false`. There
is no path — API or otherwise — that creates a profile any other way, so
every new account starts at the bottom of the ladder and an admin has to
explicitly promote it (see the bootstrap block at the bottom of
`schema.sql` for the one time that's done outside the API, via the SQL
Editor as `postgres`, which is exempt from the guard trigger's admin check).

**One capability with no matrix row of its own.** Commissioners and admins
can also write `shelter_needs` directly, outside the field-update flow —
`shelter_needs_insert_commissioner_admin`,
`shelter_needs_update_commissioner_admin`,
`shelter_needs_delete_commissioner_admin`, all gated on `is_approved() and
app_role() in ('commissioner','admin')`. This is how a commissioner corrects
a need without going through a field update tied to a headcount count.

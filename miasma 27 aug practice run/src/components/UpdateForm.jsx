/**
 * U2 — field update form. An approved volunteer/commissioner/admin files a
 * headcount + needs + note for one shelter; the write goes through
 * `api.submitUpdate`, which INSERTs into `updates` and lets the server-side
 * SECURITY DEFINER trigger apply the headcount/needs to the shelter. This
 * component never writes `shelters` or `shelter_needs` itself — volunteers
 * hold no grants on those tables (PERMISSIONS.md, "Submit field update").
 *
 * VISIBILITY CONTRACT (SPEC.md U2 "done when"): logged out or unapproved =>
 * the form is not rendered at all. `can(profile, 'submitUpdate')` is the
 * gate, and it is UX ONLY — RLS is the real wall, so a rejected insert still
 * surfaces here as a readable error rather than a silent no-op.
 *
 * The `useViewer` hook lives in this file (and is re-used by UpdatesFeed)
 * because the form is the component whose visibility SPEC.md actually pins;
 * keeping one implementation avoids two copies of the session logic drifting.
 * Both U2 files import it from here — no third file, since U2 owns exactly
 * `UpdateForm.jsx` and `UpdatesFeed.jsx`.
 */
import { useEffect, useMemo, useState } from 'react'
import { fetchShelters, submitUpdate, subscribeChanges } from '../lib/api.js'
import { can, fetchMyProfile, onAuthChange } from '../lib/auth.js'
// SUPPLY_ITEMS is the frozen 8-item catalogue, a constant rather than fetched
// data — api.js exposes no fetchSupplyItems(), and BOARD.md's note pins
// src/lib/store.js as the stable import path for shared values like this.
import { SUPPLY_ITEMS } from '../lib/store.js'

/**
 * No Supabase env vars = api.js/auth.js run against the localStorage store,
 * where there is no session to fetch and no RLS to emulate. auth.js's module
 * doc is explicit that this case means "single local demo user, full access"
 * rather than "logged out" — without this, the form would be permanently
 * hidden on any teammate's machine that has no keys yet. Deployed builds
 * always have both vars, so the real `can()` gate is what runs in judging.
 * Read from import.meta.env directly: components must not import supa.js.
 */
const LOCAL_DEMO = !(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
const LOCAL_DEMO_PROFILE = { id: 'local-demo', full_name: 'Local demo user', role: 'volunteer', approved: true }

/**
 * Current viewer's profile. Pass `profile` explicitly once the shell wires
 * auth (integrator change) and this defers to it; left undefined, the hook
 * subscribes to auth itself so each U2 component is mountable standalone.
 * @param {object|null|undefined} profileProp
 * @returns {{ profile: object|null, ready: boolean }}
 */
export function useViewer(profileProp) {
  const selfManaged = profileProp === undefined
  const [profile, setProfile] = useState(selfManaged ? (LOCAL_DEMO ? LOCAL_DEMO_PROFILE : null) : profileProp)
  const [ready, setReady] = useState(!selfManaged || LOCAL_DEMO)

  useEffect(() => {
    if (!selfManaged) {
      setProfile(profileProp)
      setReady(true)
      return
    }
    if (LOCAL_DEMO) {
      setProfile(LOCAL_DEMO_PROFILE)
      setReady(true)
      return
    }

    let alive = true
    const stop = onAuthChange((session) => {
      if (!session) {
        if (alive) {
          setProfile(null)
          setReady(true)
        }
        return
      }
      fetchMyProfile()
        .then((row) => alive && (setProfile(row), setReady(true)))
        .catch(() => alive && (setProfile(null), setReady(true)))
    })
    return () => {
      alive = false
      stop()
    }
  }, [selfManaged, profileProp])

  return { profile, ready }
}

const ITEM_LABEL = new Map(SUPPLY_ITEMS.map(([value, label]) => [value, label]))
const ITEM_UNIT = new Map(SUPPLY_ITEMS.map(([value, , unit]) => [value, unit]))

const EMPTY_NEED = { item: '', qty: '' }

/** Whole, non-negative number from a raw input string, or null if not one. */
function toCount(raw) {
  const trimmed = String(raw).trim()
  if (!trimmed || !/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isSafeInteger(n) ? n : null
}

const FIELD =
  'w-full rounded-lg border border-ink-300/70 bg-white px-3 py-2 text-sm text-ink-900 ' +
  'placeholder:text-ink-500 focus:border-accent dark:bg-ink-900/40 dark:text-ink-50'

export default function UpdateForm({ profile: profileProp }) {
  const { profile, ready } = useViewer(profileProp)
  const allowed = can(profile, 'submitUpdate')

  const [shelters, setShelters] = useState([])
  const [shelterId, setShelterId] = useState('')
  const [headcount, setHeadcount] = useState('')
  const [needRows, setNeedRows] = useState([{ ...EMPTY_NEED }])
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState({ phase: 'idle', message: '' })

  // Shelter list feeds the picker and the headcount prefill. It is public
  // data, so this succeeds even before the viewer is resolved — but there is
  // no reason to fetch it while the form is hidden.
  useEffect(() => {
    if (!allowed) return
    let alive = true

    async function load() {
      try {
        const rows = await fetchShelters()
        if (alive) setShelters(rows)
      } catch (err) {
        if (alive) setStatus({ phase: 'error', message: err.message || 'Could not load shelters.' })
      }
    }

    load()
    // Someone else's update changes a shelter's headcount; refetch so the
    // prefill below never suggests a stale number.
    const stop = subscribeChanges(() => load())
    return () => {
      alive = false
      stop()
    }
  }, [allowed])

  const selected = useMemo(() => shelters.find((s) => s.id === shelterId) ?? null, [shelters, shelterId])
  const usedItems = useMemo(() => new Set(needRows.map((r) => r.item).filter(Boolean)), [needRows])

  if (!ready || !allowed) return null

  function pickShelter(nextId) {
    setShelterId(nextId)
    // Prefill the current headcount — a field update usually adjusts it
    // rather than entering it from nothing.
    const shelter = shelters.find((s) => s.id === nextId)
    setHeadcount(shelter ? String(shelter.headcount) : '')
    setErrors((prev) => ({ ...prev, shelterId: undefined, headcount: undefined }))
  }

  function setNeedRow(index, patch) {
    setNeedRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
    setErrors((prev) => ({ ...prev, needs: undefined }))
  }

  function addNeedRow() {
    setNeedRows((prev) => [...prev, { ...EMPTY_NEED }])
  }

  function removeNeedRow(index) {
    setNeedRows((prev) => (prev.length === 1 ? [{ ...EMPTY_NEED }] : prev.filter((_, i) => i !== index)))
  }

  /** @returns {{ nextErrors: object, payload: object|null }} */
  function validate() {
    const nextErrors = {}

    if (!shelterId) nextErrors.shelterId = 'Choose a shelter.'

    const headcountValue = toCount(headcount)
    if (headcountValue === null) nextErrors.headcount = 'Headcount must be a whole number, 0 or more.'

    // Fully blank rows are "the user added a row and changed their mind" —
    // dropped silently. A half-filled row is a real mistake and is reported.
    const filled = needRows.filter((row) => row.item || String(row.qty).trim())
    const needs = []
    for (const row of filled) {
      if (!row.item) {
        nextErrors.needs = 'Pick an item for every quantity you entered.'
        continue
      }
      const qty = toCount(row.qty)
      if (qty === null || qty <= 0) {
        nextErrors.needs = `Quantity for ${ITEM_LABEL.get(row.item) ?? row.item} must be a whole number above 0.`
        continue
      }
      needs.push({ item: row.item, qty })
    }

    if (Object.keys(nextErrors).length > 0) return { nextErrors, payload: null }
    return {
      nextErrors,
      // needs is always an array — api.submitUpdate spreads it to sort.
      payload: { shelterId, headcount: headcountValue, needs, note: note.trim() },
    }
  }

  async function onSubmit(event) {
    event.preventDefault()
    const { nextErrors, payload } = validate()
    setErrors(nextErrors)
    if (!payload) {
      setStatus({ phase: 'error', message: 'Check the highlighted fields and try again.' })
      return
    }

    setStatus({ phase: 'saving', message: '' })
    try {
      await submitUpdate(payload)
      // The shelter row, the map marker and the feed all refresh off
      // subscribeChanges — nothing to reload here.
      setStatus({ phase: 'ok', message: `Update filed for ${selected?.name ?? 'the shelter'}.` })
      setNeedRows([{ ...EMPTY_NEED }])
      setNote('')
    } catch (err) {
      setStatus({ phase: 'error', message: err.message || 'Could not submit update.' })
    }
  }

  const saving = status.phase === 'saving'

  return (
    <section className="rounded-card border border-ink-300/70 bg-white p-4 dark:bg-ink-900/40" aria-labelledby="u2-form-heading">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="u2-form-heading" className="text-sm font-semibold">
          File a field update
        </h2>
        <span className="text-xs text-ink-500">{profile?.role ?? 'staff'}</span>
      </div>

      <form className="mt-3 flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor="u2-shelter" className="mb-1 block text-xs font-medium text-ink-700 dark:text-ink-100">
            Shelter
          </label>
          <select
            id="u2-shelter"
            className={FIELD}
            value={shelterId}
            onChange={(e) => pickShelter(e.target.value)}
            aria-invalid={Boolean(errors.shelterId)}
            aria-describedby={errors.shelterId ? 'u2-shelter-error' : undefined}
            disabled={saving || shelters.length === 0}
          >
            <option value="">{shelters.length === 0 ? 'Loading shelters…' : 'Select a shelter'}</option>
            {shelters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.upazila}
              </option>
            ))}
          </select>
          {errors.shelterId && (
            <p id="u2-shelter-error" className="mt-1 text-xs text-danger">
              {errors.shelterId}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="u2-headcount" className="mb-1 block text-xs font-medium text-ink-700 dark:text-ink-100">
            People sheltering now
          </label>
          <input
            id="u2-headcount"
            className={FIELD}
            value={headcount}
            onChange={(e) => {
              setHeadcount(e.target.value)
              setErrors((prev) => ({ ...prev, headcount: undefined }))
            }}
            inputMode="numeric"
            placeholder="e.g. 412"
            aria-invalid={Boolean(errors.headcount)}
            aria-describedby={
              errors.headcount ? 'u2-headcount-error' : selected ? 'u2-headcount-hint' : undefined
            }
            disabled={saving}
          />
          {errors.headcount ? (
            <p id="u2-headcount-error" className="mt-1 text-xs text-danger">
              {errors.headcount}
            </p>
          ) : (
            selected && (
              <p id="u2-headcount-hint" className="mt-1 text-xs text-ink-500">
                Capacity {selected.capacity} · currently recorded {selected.headcount}
              </p>
            )
          )}
        </div>

        <fieldset className="border-0 p-0">
          <legend className="mb-1 text-xs font-medium text-ink-700 dark:text-ink-100">Needs right now</legend>
          <div className="flex flex-col gap-2">
            {needRows.map((row, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                <select
                  className={`${FIELD} min-w-0 flex-1`}
                  value={row.item}
                  onChange={(e) => setNeedRow(index, { item: e.target.value })}
                  aria-label={`Item ${index + 1}`}
                  disabled={saving}
                >
                  <option value="">Item…</option>
                  {SUPPLY_ITEMS.map(([value, label]) => (
                    <option key={value} value={value} disabled={value !== row.item && usedItems.has(value)}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  className={`${FIELD} w-24 shrink-0`}
                  value={row.qty}
                  onChange={(e) => setNeedRow(index, { qty: e.target.value })}
                  inputMode="numeric"
                  placeholder="Qty"
                  aria-label={`Quantity for item ${index + 1}`}
                  disabled={saving}
                />
                <span className="w-12 shrink-0 text-xs text-ink-500">{ITEM_UNIT.get(row.item) ?? ''}</span>
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-ink-300/70 px-2 py-2 text-xs text-ink-500 hover:text-danger"
                  onClick={() => removeNeedRow(index)}
                  aria-label={`Remove item ${index + 1}`}
                  disabled={saving}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {errors.needs && <p className="mt-1 text-xs text-danger">{errors.needs}</p>}
          <button
            type="button"
            className="mt-2 rounded-lg border border-ink-300/70 px-3 py-1.5 text-xs font-medium text-accent disabled:opacity-50"
            onClick={addNeedRow}
            disabled={saving || needRows.length >= SUPPLY_ITEMS.length}
          >
            Add another item
          </button>
        </fieldset>

        <div>
          <label htmlFor="u2-note" className="mb-1 block text-xs font-medium text-ink-700 dark:text-ink-100">
            Note <span className="font-normal text-ink-500">(optional)</span>
          </label>
          <textarea
            id="u2-note"
            className={`${FIELD} min-h-20`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What the field team is seeing right now"
            disabled={saving}
          />
        </div>

        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={saving}
        >
          {saving ? 'Submitting…' : 'Submit update'}
        </button>

        <p
          role="status"
          aria-live="polite"
          className={`min-h-4 text-xs ${status.phase === 'error' ? 'text-danger' : 'text-ok'}`}
        >
          {status.message}
        </p>
      </form>
    </section>
  )
}

import Select from '../../components/Select.jsx'
import { STANDALONE } from './labFormHelpers.js'

// Shared by ProfessionalismPanel's create form and EditLabModal. Pure logic
// (scope, override dates) lives in labFormHelpers.js instead — re-exported
// here so call sites can import everything from one place.
export {
  STANDALONE, SCOPE_OPTIONS, sectionsInScope, inferScope,
  professionalismOverrideDates, journalOverrideDates,
} from './labFormHelpers.js'

// requireChoice: the create form's picker opens on a disabled placeholder,
// with "No journal — standalone" as an explicit option under it (value
// STANDALONE). The link-fallback and edit pickers stay optional — their
// empty value already means standalone.
export function JournalSelect({ id, value, onChange, labOptions, otherOptions, requireChoice = false }) {
  const otherLabel = labOptions.length > 0 ? 'Other assignments' : 'Assignments'
  return (
    <Select id={id} value={value} onChange={onChange}>
      {requireChoice ? (
        <>
          <option value="" disabled>Select a journal, or standalone</option>
          <option value={STANDALONE}>No journal — standalone</option>
        </>
      ) : (
        <option value="">No journal — standalone</option>
      )}
      {labOptions.length > 0 && (
        <optgroup label="Published lab assignments">
          {labOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </optgroup>
      )}
      {otherOptions.length > 0 && (
        <optgroup label={otherLabel}>
          {otherOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </optgroup>
      )}
    </Select>
  )
}

export function ModulePicker({ id, modules, value, onChange }) {
  return (
    <Select
      id={id}
      value={value}
      onChange={onChange}
      options={[{ value: '', label: 'No module' }, ...modules.map(m => ({ value: m.id, label: m.name }))]}
    />
  )
}

import { CalendarCheck, ChefHat } from 'lucide-react'

// Single source of truth for all tool pages.
// AppNav, settings, and the home page all read from here.
// To add a new tool: append one entry — nothing else needs changing.
//
// Labs & Attendance and Professionalism by Unit used to be two separate
// tools here. They shared no data (a lab's "unit" was a free-typed label
// that reset every page load, nothing to do with the lab itself) despite
// being one real workflow: create a lab, take attendance, score it, roll
// the score up. Merged into one tool with four tabs (Setup, Labs,
// Attendance, Scoring) instead — see DECISIONS.md.

export const MODULES = [
  { id: 'grading', label: 'Grading' },
  { id: 'classroom', label: 'Classroom' },
]

export const TOOLS = [
  {
    id:          'labs',
    module:      'grading',
    label:       'Labs, Attendance & Professionalism',
    shortLabel:  'Labs',
    description: 'Create Professionalism assignments (paired with a lab journal, or standalone), take attendance, score students, and roll scores up by Unit and Term back to the gradebook.',
    Icon:        CalendarCheck,
    route:       'labs',
  },
  {
    id:          'rotation',
    module:      'classroom',
    label:       'Kitchen Rotation',
    shortLabel:  'Rotation',
    description: 'Seat each class in the eight kitchens from its Canvas roster, rotate students through job titles, share out extra duties and center-sink turns, and show the board full screen.',
    Icon:        ChefHat,
    route:       'rotation',
  },
]

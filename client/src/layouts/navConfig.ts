import { Users, CalendarCheck, Group, Shuffle, Mail, type LucideIcon } from 'lucide-react';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

// Sidebar order is fixed (DESIGN_SYSTEM.md): Students, Attendance, Grouping, Name Picker, Email.
export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Students', path: '/students', icon: Users },
  { label: 'Attendance', path: '/attendance', icon: CalendarCheck },
  { label: 'Grouping', path: '/grouping', icon: Group },
  { label: 'Name Picker', path: '/name-picker', icon: Shuffle },
  { label: 'Email', path: '/email', icon: Mail },
];

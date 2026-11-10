/**
 * The simulated phone's observable state.
 *
 * Everything a success predicate can look at lives here. Screen trees are
 * derived from this state by the fixture apps, so state, UI and predicate stay
 * consistent instead of being three separate scripts.
 */

export interface DeviceProfile {
  model: string;
  androidVersion: string;
  build: string;
  screenWidth: number;
  screenHeight: number;
  densityDpi: number;
  locale: string;
}

export interface SettingsState {
  wifi: boolean;
  bluetooth: boolean;
  airplaneMode: boolean;
  brightness: number;
  wifiNetwork: string;
  wifiPassword: string;
}

export interface Message {
  id: string;
  from: string;
  text: string;
}

export interface Thread {
  id: string;
  from: string;
  preview: string;
  unread: boolean;
  archived: boolean;
  /** Simulates a failed first load; retry clears it. */
  failedLoads: number;
  messages: Message[];
}

export interface Note {
  id: string;
  title: string;
  body: string;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  address: string;
}

export interface MailMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
  read: boolean;
  folder: 'inbox' | 'archive';
}

export interface MailDraft {
  to: string;
  subject: string;
  body: string;
}

export type ProductCategory = 'Audio' | 'Home' | 'Office';

export interface Product {
  id: string;
  name: string;
  price: number;
  rating: number;
  category: ProductCategory;
}

export interface Order {
  id: string;
  items: string[];
  address: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  location: string;
}

export interface Reminder {
  id: string;
  title: string;
  time: string;
}

export interface AuthEntry {
  id: string;
  account: string;
  code: string;
}

export interface Shipment {
  tracking: string;
  status: string;
}

export interface UiState {
  foreground: string | null;
  screen: string;
  history: string[];
  toasts: string[];
  /** Clipboard read notifications are not implied; agents call observe. */
}

export interface Selection {
  threadId: string | null;
  noteId: string | null;
  contactId: string | null;
  mailId: string | null;
  productId: string | null;
  eventId: string | null;
}

export interface WorldState {
  device: DeviceProfile;
  battery: { percent: number; charging: boolean };
  settings: SettingsState;
  clipboard: string;
  notifications: string[];
  messages: Thread[];
  notes: Note[];
  contacts: Contact[];
  mail: MailMessage[];
  mailDrafts: MailDraft[];
  shop: {
    products: Product[];
    category: 'All' | ProductCategory;
    cart: string[];
    orders: Order[];
    checkoutAddress: string;
    verifyCode: string;
    verified: boolean;
  };
  bank: {
    loggedIn: boolean;
    balance: string;
    validCodes: string[];
    transfers: Array<{ to: string; amount: string }>;
  };
  calculator: {
    display: string;
    left: number | null;
    op: '+' | '-' | '*' | '/' | null;
    /** True when the next digit starts a new number. */
    fresh: boolean;
  };
  calendar: CalendarEvent[];
  clock: { reminders: Reminder[] };
  authenticator: AuthEntry[];
  delivery: {
    shipments: Shipment[];
    query: string;
    tracked: boolean;
    lastStatus: string;
  };
  selection: Selection;
  /** Per-screen form buffers; screens derive editable values from here. */
  forms: Record<string, Record<string, string>>;
  faults: {
    /** Number of `wait_for` calls that should time out before succeeding. */
    waitFailuresRemaining: number;
  };
  ui: UiState;
}

export function createWorld(): WorldState {
  return {
    device: {
      model: 'Pixel 6a',
      androidVersion: '14',
      build: 'AP1A.240305.019',
      screenWidth: 1080,
      screenHeight: 2400,
      densityDpi: 420,
      locale: 'en-US',
    },
    battery: { percent: 76, charging: false },
    settings: {
      wifi: true,
      bluetooth: true,
      airplaneMode: false,
      brightness: 40,
      wifiNetwork: 'HomeNet',
      wifiPassword: 'correct-horse-battery',
    },
    clipboard: '',
    notifications: [],
    messages: [
      {
        id: 'bank',
        from: 'Bank Alerts',
        preview: 'Your verification code is 639201',
        unread: true,
        archived: false,
        failedLoads: 0,
        messages: [
          {
            id: 'bank-1',
            from: 'Bank Alerts',
            text: 'Your verification code is 639201. It expires in 5 minutes.',
          },
        ],
      },
      {
        id: 'mom',
        from: 'Mom',
        preview: 'Dinner on Sunday?',
        unread: true,
        archived: false,
        failedLoads: 0,
        messages: [{ id: 'mom-1', from: 'Mom', text: 'Dinner on Sunday at 18:00?' }],
      },
      {
        id: 'invoice',
        from: 'Acme Billing',
        preview: 'Invoice #2291 is ready',
        unread: true,
        archived: false,
        failedLoads: 0,
        messages: [
          {
            id: 'invoice-1',
            from: 'Acme Billing',
            text: 'Invoice #2291 is ready. Payment code 229144. Total $42.00.',
          },
        ],
      },
      {
        id: 'ada',
        from: 'Ada',
        preview: 'My new number is 555-0182',
        unread: false,
        archived: false,
        failedLoads: 0,
        messages: [{ id: 'ada-1', from: 'Ada', text: 'My new number is 555-0182.' }],
      },
      {
        id: 'parcel',
        from: 'Parcel',
        preview: 'Tracking 1Z999AA10123456784',
        unread: false,
        archived: false,
        failedLoads: 0,
        messages: [
          { id: 'parcel-1', from: 'Parcel', text: 'Out for delivery. Tracking 1Z999AA10123456784.' },
        ],
      },
    ],
    notes: [{ id: 'todo', title: 'todo', body: 'call the dentist' }],
    contacts: [
      {
        id: 'grace',
        name: 'Grace Hopper',
        phone: '555-0101',
        address: '1 Navy Yard, Arlington',
      },
    ],
    mail: [
      {
        id: 'flight',
        from: 'Sky Airlines',
        subject: 'Your flight booking',
        body: 'Booking reference PX-8842. Departure 2026-11-12 15:30.',
        read: false,
        folder: 'inbox',
      },
      {
        id: 'bill',
        from: 'Dinner Club',
        subject: 'Dinner total',
        body: 'The total was $96 for 3 friends.',
        read: true,
        folder: 'inbox',
      },
      {
        id: 'verify',
        from: 'Shop',
        subject: 'Verify your account',
        body: 'Your verification code is 771204.',
        read: false,
        folder: 'inbox',
      },
      {
        id: 'tracking',
        from: 'Parcel',
        subject: 'Shipment update',
        body: 'Tracking number 1Z999AA10123456784. Status: in transit.',
        read: true,
        folder: 'inbox',
      },
    ],
    mailDrafts: [],
    shop: {
      products: [
        { id: 'p-headphones', name: 'Studio Headphones', price: 49.99, rating: 4.6, category: 'Audio' },
        { id: 'p-speaker', name: 'Desk Speaker', price: 39, rating: 4.2, category: 'Audio' },
        { id: 'p-lamp', name: 'Reading Lamp', price: 29, rating: 4.8, category: 'Home' },
        { id: 'p-rug', name: 'Wool Rug', price: 79, rating: 4.4, category: 'Home' },
        { id: 'p-coffee', name: 'Cold Brew Kit', price: 35, rating: 4.7, category: 'Home' },
        { id: 'p-candle', name: 'Soy Candle', price: 18, rating: 4.5, category: 'Home' },
        { id: 'p-keyboard', name: 'Mechanical Keyboard', price: 89, rating: 4.9, category: 'Office' },
        { id: 'p-stand', name: 'Laptop Stand', price: 45, rating: 4.6, category: 'Office' },
      ],
      category: 'All',
      cart: [],
      orders: [],
      checkoutAddress: '',
      verifyCode: '771204',
      verified: false,
    },
    bank: {
      loggedIn: false,
      balance: '$1,234.56',
      validCodes: ['639201', '118042'],
      transfers: [],
    },
    calculator: { display: '0', left: null, op: null, fresh: true },
    calendar: [
      {
        id: 'standup',
        title: 'Team standup',
        date: '2026-11-12',
        time: '15:30',
        location: 'Room 4',
      },
    ],
    clock: { reminders: [] },
    authenticator: [
      { id: 'auth-bank', account: 'bank.example', code: '118042' },
      { id: 'auth-mail', account: 'mail.example', code: '905517' },
    ],
    delivery: {
      shipments: [{ tracking: '1Z999AA10123456784', status: 'In transit' }],
      query: '',
      tracked: false,
      lastStatus: '',
    },
    selection: {
      threadId: null,
      noteId: null,
      contactId: null,
      mailId: null,
      productId: null,
      eventId: null,
    },
    forms: {},
    faults: { waitFailuresRemaining: 0 },
    ui: { foreground: null, screen: 'system.launcher', history: [], toasts: [] },
  };
}

/** Get a form buffer, creating an empty one on first use. */
export function form(world: WorldState, name: string): Record<string, string> {
  const existing = world.forms[name];
  if (existing !== undefined) return existing;
  const created: Record<string, string> = {};
  world.forms[name] = created;
  return created;
}

export function beginForm(world: WorldState, name: string, initial: Record<string, string>): Record<string, string> {
  const created = { ...initial };
  world.forms[name] = created;
  return created;
}

export function field(world: WorldState, name: string, key: string): string {
  return form(world, name)[key] ?? '';
}

export function setField(world: WorldState, name: string, key: string, value: string): void {
  form(world, name)[key] = value;
}

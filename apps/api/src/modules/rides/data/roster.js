// Demo driver roster, ported from Module B (config/drivers.js). The seed turns each entry into
// a platform user with role `driver`, a rides_drivers row and the vehicle it drives; nothing
// reads this list at request time.
const DEMO_DRIVERS = [
  {
    name: 'Ramesh Patil',
    gender: 'male',
    rating: '4.8',
    vehicle: 'Bajaj RE Auto',
    plateNumber: 'MH 02 EK 4417',
  },
  {
    name: 'Sunil Yadav',
    gender: 'male',
    rating: '4.6',
    vehicle: 'Piaggio Ape Auto',
    plateNumber: 'MH 02 FR 1093',
  },
  {
    name: 'Anil Gaikwad',
    gender: 'male',
    rating: '4.9',
    vehicle: 'Bajaj RE Compact',
    plateNumber: 'MH 47 AT 7720',
  },
  {
    name: 'Mahesh Shinde',
    gender: 'male',
    rating: '4.7',
    vehicle: 'TVS King Auto',
    plateNumber: 'MH 03 CV 2586',
  },
  {
    name: 'Vijay Kadam',
    gender: 'male',
    rating: '4.5',
    vehicle: 'Bajaj RE CNG',
    plateNumber: 'MH 02 DQ 9314',
  },
  {
    name: 'Sunita Jadhav',
    gender: 'female',
    rating: '4.9',
    vehicle: 'Bajaj RE Auto',
    plateNumber: 'MH 02 GK 5521',
  },
  {
    name: 'Priya More',
    gender: 'female',
    rating: '4.8',
    vehicle: 'Piaggio Ape Auto',
    plateNumber: 'MH 47 BX 3308',
  },
];

// Module B's deterministic per-vehicle document offsets (days from today), so the demo shows
// an auto with expired PUC, one with an expired permit, one with insurance expiring and one
// overdue for service. `drivenKm` is km on the odometer since the last service.
const VEHICLE_OFFSETS = [
  { permit: 300, insurance: 210, puc: 120, fitness: 400, service: -40, drivenKm: 1200 },
  { permit: 180, insurance: 10, puc: 95, fitness: 260, service: -90, drivenKm: 2400 },
  { permit: 240, insurance: 150, puc: -5, fitness: 310, service: -20, drivenKm: 800 },
  { permit: 90, insurance: 120, puc: 40, fitness: 150, service: -200, drivenKm: 3400 },
  { permit: -12, insurance: 200, puc: 160, fitness: 220, service: -60, drivenKm: 1500 },
  { permit: 365, insurance: 280, puc: 190, fitness: 420, service: -15, drivenKm: 450 },
  { permit: 200, insurance: 95, puc: 75, fitness: 330, service: -70, drivenKm: 1900 },
];

// Two extra driver accounts with no vehicle, to show the verification states.
const STATE_DEMO_DRIVERS = [
  { name: 'Kiran Pawar', gender: 'male', state: 'licence_expiring' },
  { name: 'Ganesh Salunkhe', gender: 'male', state: 'no_documents' },
];

const driverEmail = (name) => `${name.toLowerCase().replace(/\s+/g, '.')}@drivers.universe.test`;

module.exports = { DEMO_DRIVERS, VEHICLE_OFFSETS, STATE_DEMO_DRIVERS, driverEmail };

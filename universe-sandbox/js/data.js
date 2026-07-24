// Solar system data with REAL orbital elements (J2000 epoch, NASA/JPL values,
// independently verified). Units: AU, solar mass, day, degrees.
//
//  a_AU      : semi-major axis (planets: around the Sun; moons: around parent)
//  e         : eccentricity
//  inc_deg   : inclination (planets: to the ecliptic; moons: to parent equator/orbit)
//  mass_Msun : mass in solar masses (drives gravity)
//  radius_km : physical radius (drives the to-scale rendered size)
//
// Bodies are rendered at true relative size (radius_km), so moons sit OUTSIDE
// their planets at their real distances. A per-frame minimum apparent size keeps
// every body visible as a dot when zoomed out; zoom in to resolve moon systems.

export const SUN = { name: '太陽', mass_Msun: 1.0, radius_km: 696340, color: 0xffcc33 };

export const PLANETS = [
  { name: '水星',   en: 'Mercury', a_AU: 0.38709927, e: 0.20563593, inc_deg: 7.00497902, mass_Msun: 1.6601e-7,   radius_km: 2440.53, color: 0xb0a499 },
  { name: '金星',   en: 'Venus',   a_AU: 0.72333566, e: 0.00677672, inc_deg: 3.39467605, mass_Msun: 2.4478e-6,   radius_km: 6051.8,  color: 0xe8cda0 },
  { name: '地球',   en: 'Earth',   a_AU: 1.00000261, e: 0.01671123, inc_deg: 0.0,        mass_Msun: 3.0035e-6,   radius_km: 6378.14, color: 0x3a7bd5 },
  { name: '火星',   en: 'Mars',    a_AU: 1.52371034, e: 0.0933941,  inc_deg: 1.84969142, mass_Msun: 3.2271e-7,   radius_km: 3396.19, color: 0xc1440e },
  { name: '木星',   en: 'Jupiter', a_AU: 5.202887,   e: 0.04838624, inc_deg: 1.30439695, mass_Msun: 9.5458e-4,   radius_km: 71492,   color: 0xd8a070 },
  { name: '土星',   en: 'Saturn',  a_AU: 9.53667594, e: 0.05386179, inc_deg: 2.48599187, mass_Msun: 2.8576e-4,   radius_km: 60268,   color: 0xe3c98f, ring: true },
  { name: '天王星', en: 'Uranus',  a_AU: 19.18916464, e: 0.04725744, inc_deg: 0.77263783, mass_Msun: 4.3662e-5,  radius_km: 25559,   color: 0x9fe6e6 },
  { name: '海王星', en: 'Neptune', a_AU: 30.06992276, e: 0.00859048, inc_deg: 1.77004347, mass_Msun: 5.1514e-5,  radius_km: 24764,   color: 0x3f54ba },
];

export const MOONS = [
  { name: '月',       en: 'Moon',     parent: 'Earth',   a_AU: 0.0025695553, e: 0.0554,   inc_deg: 5.16,   period_days: 27.321661, mass_Msun: 3.694303e-8, radius_km: 1737.4, color: 0xcfcfcf },
  { name: 'イオ',     en: 'Io',       parent: 'Jupiter', a_AU: 0.0028195588, e: 0.004,    inc_deg: 0.04,   period_days: 1.769138,  mass_Msun: 4.490849e-8, radius_km: 1821.5, color: 0xe7d96b },
  { name: 'エウロパ', en: 'Europa',   parent: 'Jupiter', a_AU: 0.0044860264, e: 0.009,    inc_deg: 0.47,   period_days: 3.551181,  mass_Msun: 2.413272e-8, radius_km: 1560.8, color: 0xd9c9a8 },
  { name: 'ガニメデ', en: 'Ganymede', parent: 'Jupiter', a_AU: 0.0071551821, e: 0.001,    inc_deg: 0.20,   period_days: 7.154553,  mass_Msun: 7.45057e-8,  radius_km: 2631.2, color: 0x9a8d7e },
  { name: 'カリスト', en: 'Callisto', parent: 'Jupiter', a_AU: 0.0125850722, e: 0.007,    inc_deg: 0.19,   period_days: 16.689017, mass_Msun: 5.409654e-8, radius_km: 2410.3, color: 0x6e655c },
  { name: 'タイタン', en: 'Titan',    parent: 'Saturn',  a_AU: 0.008167897,  e: 0.0288,   inc_deg: 0.35,   period_days: 15.945421, mass_Msun: 6.765106e-8, radius_km: 2574.8, color: 0xe0a33a },
  { name: 'レア',     en: 'Rhea',     parent: 'Saturn',  a_AU: 0.0035241143, e: 0.001,    inc_deg: 0.35,   period_days: 4.518212,  mass_Msun: 1.159965e-9, radius_km: 763.5,  color: 0xcfd2d6 },
  { name: 'タイタニア', en: 'Titania', parent: 'Uranus',  a_AU: 0.002916472,  e: 0.0011,   inc_deg: 0.34,   period_days: 8.705872,  mass_Msun: 1.709712e-9, radius_km: 788.9,  color: 0xb9c6cc },
  { name: 'オベロン', en: 'Oberon',   parent: 'Uranus',  a_AU: 0.0039005836, e: 0.0014,   inc_deg: 0.10,   period_days: 13.463239, mass_Msun: 1.546954e-9, radius_km: 761.4,  color: 0x9aa3a8 },
  { name: 'トリトン', en: 'Triton',   parent: 'Neptune', a_AU: 0.0023716915, e: 0.000016, inc_deg: 156.87, period_days: 5.876854,  mass_Msun: 1.076384e-8, radius_km: 1352.6, color: 0xcdbfe0 },
];

/**
 * Sample content for Van Cortlandt Park: areas, trails and visitor facts.
 *
 * Coordinates are approximate and the facts are drafted from public
 * knowledge of the park. Both should be reviewed by park staff and
 * naturalists before launch (real bench data comes in through the CSV import).
 */

export interface AreaSeed {
  name: string;
  /** Approximate centre, used to scatter sample benches. */
  center: [number, number];
  benches: number;
  description: string;
  facts: string[];
}

export interface TrailSeed {
  slug: string;
  name: string;
  lengthMiles: number;
  description: string;
  facts: string[];
  path: [number, number][];
  benches: number;
}

export const AREAS: AreaSeed[] = [
  {
    name: 'Parade Ground',
    center: [40.8923, -73.8893],
    benches: 80,
    description: 'Wide open lawns in the south of the park, home to cricket, soccer and the start of the cross-country course.',
    facts: [
      'The Parade Ground takes its name from the military drills held here in the early 1900s.',
      "Van Cortlandt Park is one of New York City's centres of cricket. Matches fill these fields on summer weekends.",
      'Watch the open grass for American robins and northern flickers probing the soil for insects.',
    ],
  },
  {
    name: 'Van Cortlandt Lake',
    center: [40.8977, -73.8909],
    benches: 70,
    description: 'Open water, reeds and wetland edges at the heart of the park, fed by Tibbetts Brook.',
    facts: [
      'Van Cortlandt Lake is the largest freshwater lake in the Bronx.',
      'The lake was created in the late 1600s, when the Van Cortlandt family dammed Tibbetts Brook to power a mill.',
      'Great blue herons and egrets stalk the shallows here, and red-winged blackbirds call from the cattails in spring.',
      'On sunny days, look for painted turtles basking on logs along the shore.',
    ],
  },
  {
    name: 'Van Cortlandt House',
    center: [40.8906, -73.8957],
    benches: 40,
    description: 'The historic heart of the park, around the 18th-century Van Cortlandt House.',
    facts: [
      'Van Cortlandt House, built in 1748, is the oldest surviving building in the Bronx.',
      'George Washington used the house during the Revolutionary War.',
      'Nearby Vault Hill holds the Van Cortlandt family vault, where city records are said to have been hidden during the Revolution.',
    ],
  },
  {
    name: 'Golf Course Paths',
    center: [40.8995, -73.8838],
    benches: 50,
    description: 'Walkways skirting the Van Cortlandt Golf Course.',
    facts: [
      'Van Cortlandt Golf Course opened in 1895, making it the oldest public golf course in the United States.',
      'The ponds and mowed lawns here attract Canada geese all year round.',
    ],
  },
  {
    name: 'Northwest Forest',
    center: [40.9048, -73.8935],
    benches: 60,
    description: "One of the park's oldest woodlands, with steep ridges and tall hardwoods.",
    facts: [
      'Tall oaks, hickories and tulip trees make up much of the Northwest Forest canopy.',
      'In early May, migrating warblers pass through the treetops. Listen for their songs at dawn.',
      'Red-tailed hawks are often seen circling above the forest.',
    ],
  },
  {
    name: 'Northeast Forest',
    center: [40.9015, -73.8768],
    benches: 50,
    description: 'Quiet, rocky woodland on the east side of the park.',
    facts: [
      'The rocky outcrops here are part of the ancient bedrock that underlies much of the Bronx.',
      "White-tailed deer have returned to the Bronx's larger parks in recent decades. Look for tracks on muddy paths.",
      'In early spring, wildflowers such as trout lily and mayapple bloom before the trees leaf out.',
    ],
  },
  {
    name: 'Croton Woods',
    center: [40.9030, -73.8862],
    benches: 45,
    description: 'Woodland in the middle of the park, crossed by the Old Croton Aqueduct.',
    facts: [
      'The Old Croton Aqueduct, buried beneath this area, began carrying water to New York City in 1842.',
      'Stone ventilator towers along the aqueduct let air in so the water could flow smoothly.',
    ],
  },
  {
    name: 'Southwest Fields',
    center: [40.8885, -73.8985],
    benches: 55,
    description: 'Meadows and fields near Broadway at the southwest corner of the park.',
    facts: [
      'Tibbetts Brook flows south from Yonkers through the park on its way to the lake.',
      'In late summer, goldenrod and asters bloom along the meadow edges and draw monarch butterflies.',
    ],
  },
];

export const TRAILS: TrailSeed[] = [
  {
    slug: 'john-muir',
    name: 'John Muir Trail',
    lengthMiles: 1.5,
    description: 'Crosses the whole park from west to east, passing through three different forests.',
    facts: [
      'The trail is named for John Muir, the naturalist who helped found America’s national parks.',
      "It is the only trail that crosses the entire park, linking the Northwest, Croton and Northeast forests.",
    ],
    path: [
      [40.899, -73.8975],
      [40.8985, -73.894],
      [40.8978, -73.8905],
      [40.8985, -73.887],
      [40.8995, -73.8835],
      [40.9005, -73.88],
      [40.901, -73.8765],
    ],
    benches: 16,
  },
  {
    slug: 'old-putnam',
    name: 'Old Putnam Trail',
    lengthMiles: 1.5,
    description: 'A flat, easy path along a former railroad line, running north past the lake and golf course.',
    facts: [
      'The trail follows the bed of the old Putnam Division railroad, which carried passengers until 1958.',
      'Its gentle grade makes it one of the most accessible walks in the park.',
    ],
    path: [
      [40.8935, -73.887],
      [40.8965, -73.8878],
      [40.9, -73.888],
      [40.904, -73.8876],
      [40.908, -73.887],
      [40.912, -73.8862],
    ],
    benches: 16,
  },
  {
    slug: 'cass-gallagher',
    name: 'Cass Gallagher Nature Trail',
    lengthMiles: 1.3,
    description: "A rugged loop over the Northwest Forest's rocky ridges.",
    facts: [
      'The trail honours Cass Gallagher, a local conservationist who campaigned to protect the park’s forests.',
      'Expect roots and rock scrambles: this is the wildest-feeling walk in the park.',
    ],
    path: [
      [40.903, -73.8965],
      [40.905, -73.8958],
      [40.9072, -73.8945],
      [40.9085, -73.8925],
      [40.9075, -73.8905],
      [40.9055, -73.891],
      [40.904, -73.893],
      [40.903, -73.8965],
    ],
    benches: 12,
  },
  {
    slug: 'old-croton-aqueduct',
    name: 'Old Croton Aqueduct Trail',
    lengthMiles: 1.1,
    description: 'Follows the route of the buried 1842 aqueduct north through Croton Woods.',
    facts: [
      'Beyond the park, the trail continues north for about 26 miles to the Croton Dam.',
      'The aqueduct was one of the great engineering works of its day, carrying water by gravity alone.',
    ],
    path: [
      [40.895, -73.8845],
      [40.899, -73.885],
      [40.903, -73.8858],
      [40.907, -73.8855],
      [40.911, -73.8848],
    ],
    benches: 12,
  },
  {
    slug: 'cross-country',
    name: 'Cross Country Course',
    lengthMiles: 3.1,
    description: 'The famous 5K running course, from the Parade Ground up into the "Back Hills" and back.',
    facts: [
      'Runners have raced on this course for more than a century. It is one of the best-known cross-country courses in the country.',
      'The hilly "Back Hills" section climbs into the Northwest Forest before the fast finish on the Parade Ground.',
    ],
    path: [
      [40.8905, -73.893],
      [40.8935, -73.8925],
      [40.896, -73.8945],
      [40.8985, -73.896],
      [40.901, -73.895],
      [40.9, -73.8915],
      [40.896, -73.8905],
      [40.8925, -73.889],
      [40.8905, -73.893],
    ],
    benches: 14,
  },
];

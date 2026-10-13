// Points hand-read off the King's Landing maps in assets/sites/kingsLanding/, in each image's own pixels.
// plan.mjs fits every map onto a shared frame and averages them into our own plan of the city.
// - painting: the official bird's-eye painting (kingslanding.jpg), on a 2000px-wide copy; oblique, so it is
//   fitted with a homography plus a relief correction. Its orientation (river south, bay east) matches the
//   Known World map, so the plan keeps it: north is up.
// - sinclair / cziegler / wiki: flat fan maps (references/), fitted by rotation + scale + shift. Cziegler and
//   the wiki map are drawn turned ~90° (river along the east side); the fit takes care of that.
// `weight` = trust in the average. The painting is the officially licensed map; the wiki map is low-res and
// unlabelled (its numbers were matched to places by their position), so it counts for less.

export const PAINTING = {
  weight: 2,
  points: {
    // gates
    'Gate of the Gods': [440, 258], 'Old Gate': [1140, 293], 'Dragon Gate': [1715, 342], 'Iron Gate': [1855, 635],
    'Lion Gate': [220, 475], "King's Gate": [132, 888], 'River Gate': [810, 1038],
    // landmarks
    'The Red Keep': [1455, 830], 'Great Sept of Baelor': [655, 618], Dragonpit: [1505, 425],
    'Guildhall of the Alchemists': [800, 598], 'West Barracks': [515, 345], 'East Barracks': [1695, 375],
    Fishmarket: [565, 1062], "Cobbler's Square": [590, 390], "Fishmonger's Square": [840, 990],
    'Plaza of the Sept': [860, 610], "Chataya's": [1395, 388], "Shae's Manse": [1745, 590],
    "Littlefinger's Brothel": [1150, 915], 'Shop of Tobho Mott': [455, 640], 'Tourney Grounds': [60, 860],
    'Winch Towers': [1540, 1180],
    // labels only the painting has
    'Flea Bottom': [1335, 600], "Visenya's Hill": [620, 790], "Rhaenys's Hill": [1580, 480], "Aegon's High Hill": [1460, 960],
    'Street of Steel': [505, 640], 'Street of the Sisters': [1135, 548], 'Street of Silk': [1390, 408],
    'Muddy Way': [915, 765], 'The Hook': [1030, 865], 'River Row': [940, 1025],
    Kingsroad: [350, 175], Goldroad: [120, 535], 'Rosby road': [1960, 625],
    'Blackwater Rush': [400, 1105], 'Blackwater Bay': [1800, 1000],
  },
  wall: [
    [132, 888], [128, 800], [135, 700], [150, 610], [178, 530], [232, 455], [290, 380], [345, 310], [395, 268], [440, 258],
    [530, 250], [635, 256], [745, 252], [865, 262], [970, 266], [1080, 282], [1140, 293], [1245, 292], [1340, 298], [1440, 302],
    [1555, 312], [1630, 325], [1715, 342], [1775, 375], [1795, 430], [1812, 500], [1832, 570], [1855, 635], [1846, 700],
    [1790, 740], [1700, 775], [1615, 810], [1560, 860], [1460, 885], [1360, 900], [1300, 925], [1235, 965], [1160, 995],
    [1050, 1022], [985, 1028], [880, 1035], [810, 1038], [680, 1032], [580, 1022], [480, 1012], [400, 1000], [300, 980],
    [215, 958], [150, 910],
  ],
  // Main streets and roads as painted (names from the painting, Sinclair and Cziegler; two invented).
  streets: {
    'Street of the Sisters': [[900, 600], [1135, 550], [1320, 490], [1490, 435]],
    'Street of Steel': [[840, 1000], [740, 975], [650, 945], [560, 880], [490, 800], [455, 700], [480, 670], [560, 645], [640, 620]],
    'Street of Silk': [[1290, 330], [1350, 370], [1420, 415], [1470, 440]],
    'Muddy Way': [[875, 640], [925, 700], [915, 790], [885, 900], [855, 985]],
    'The Hook': [[895, 880], [950, 880], [1030, 865], [1110, 840], [1200, 800]],
    'River Row': [[150, 905], [300, 955], [480, 995], [650, 1010], [840, 1015], [960, 1030], [1100, 1000], [1200, 960]],
    "Aegon's Way": [[900, 620], [1000, 680], [1100, 740], [1220, 790], [1350, 815]], // the tree-lined avenue to the Red Keep (invented name)
    'Iron Way': [[900, 615], [1300, 610], [1700, 618], [1850, 632]], // plaza to the Iron Gate (invented name)
    'Gods Way': [[860, 600], [730, 490], [600, 390], [520, 320], [445, 262]], // Cziegler's "Gods' Way"
  },
  roads: {
    Kingsroad: [[440, 258], [400, 180], [350, 100], [320, 20]],
    Goldroad: [[220, 475], [150, 500], [60, 520]],
    'Rosby road': [[1855, 635], [1930, 600], [1990, 560]],
  },
  // Rocky cliffs of Aegon's High Hill down to the bay: no houses.
  noBuild: [[985, 1040], [1300, 935], [1560, 870], [1850, 710], [2000, 690], [2000, 1050], [1500, 1110], [985, 1090]],
  title: [[1560, 20], [1950, 20], [1950, 200], [1560, 200]], // cartouche
};

export const MAPS = {
  sinclair: { // references/sinclair.png, 1216x796 (James Sinclair)
    weight: 1,
    points: {
      'Gate of the Gods': [275, 55], 'Old Gate': [655, 28], 'Dragon Gate': [935, 32], 'Iron Gate': [1055, 290],
      'Lion Gate': [214, 318], "King's Gate": [225, 645], 'River Gate': [590, 700],
      'Great Sept of Baelor': [460, 382], Dragonpit: [858, 145], 'The Red Keep': [905, 627], "Chataya's": [778, 68],
      'Guildhall of the Alchemists': [525, 325], "Cobbler's Square": [397, 133], 'Winch Towers': [962, 770],
      "Shae's Manse": [995, 232], "Fishmonger's Square": [590, 678], 'Shop of Tobho Mott': [376, 420],
      'Plaza of the Sept': [565, 305], Fishmarket: [580, 740],
    },
    wall: [
      [275, 55], [300, 40], [400, 30], [500, 25], [600, 25], [700, 25], [800, 25], [935, 30], [960, 45], [990, 90],
      [1015, 150], [1035, 220], [1055, 290], [1062, 330], [1050, 380], [1000, 410], [970, 440], [955, 480], [952, 560],
      [950, 630], [930, 660], [900, 670], [855, 690], [800, 690], [700, 695], [600, 700], [500, 705], [400, 700],
      [300, 680], [230, 655], [215, 620], [210, 500], [205, 420], [213, 320], [230, 200], [250, 100],
    ],
    // The three hills from Sinclair's contours: the outermost contour as an ellipse (centre, semi-axes, angle
    // in degrees, clockwise from east) and the summit. Heights are ours: the books only say Aegon's is highest.
    hills: {
      "Aegon's High Hill": { centre: [845, 590], axes: [135, 105], angle: 20, summit: [905, 627], height: 60 },
      "Visenya's Hill": { centre: [410, 445], axes: [190, 100], angle: -47, summit: [465, 380], height: 45 },
      "Rhaenys's Hill": { centre: [710, 155], axes: [235, 75], angle: -5, summit: [858, 145], height: 40 },
    },
  },
  cziegler: { // references/cziegler.png, 736x1041 (Sandor Cziegler); "Regi Kapu" = Old Gate
    weight: 1,
    points: {
      'Dragon Gate': [270, 207], 'Iron Gate': [465, 238], 'Old Gate': [153, 402], 'Gate of the Gods': [36, 640],
      'Lion Gate': [180, 790], "King's Gate": [395, 900], 'River Gate': [583, 672],
      'The Red Keep': [585, 445], Dragonpit: [322, 312], 'Great Sept of Baelor': [322, 640], "Chataya's": [255, 290],
      "Shae's Manse": [445, 248], 'East Barracks': [285, 228], 'West Barracks': [88, 635],
      'Guildhall of the Alchemists': [322, 578], "Cobbler's Square": [158, 608], 'Shop of Tobho Mott': [330, 705],
      "Fishmonger's Square": [545, 672], "Littlefinger's Brothel": [565, 585], Fishmarket: [465, 860],
      'Winch Towers': [680, 530], 'Plaza of the Sept': [310, 548],
    },
    wall: [
      [270, 207], [335, 197], [380, 208], [430, 225], [465, 238], [490, 232], [515, 268], [538, 300], [545, 352],
      [600, 365], [680, 410], [700, 440], [650, 480], [655, 520], [640, 580], [610, 640], [583, 672], [540, 742],
      [515, 792], [480, 832], [440, 872], [410, 905], [383, 893], [330, 876], [265, 843], [215, 815], [180, 790],
      [130, 745], [102, 713], [60, 680], [33, 655], [38, 625], [80, 530], [120, 467], [153, 402], [195, 330],
      [222, 287], [245, 238],
    ],
  },
  wiki: { // references/wiki.png, 400x400 (A Wiki of Ice and Fire)
    weight: 0.5,
    points: {
      'Dragon Gate': [152, 66], 'Iron Gate': [232, 78], 'Old Gate': [108, 140], 'Gate of the Gods': [52, 245],
      'Lion Gate': [110, 295], "King's Gate": [205, 350], 'River Gate': [268, 268],
      'The Red Keep': [297, 168], Dragonpit: [167, 104], 'Great Sept of Baelor': [167, 240],
      'Plaza of the Sept': [167, 207], "Fishmonger's Square": [265, 258],
    },
    wall: [
      [150, 65], [180, 62], [215, 70], [240, 75], [255, 95], [262, 120], [275, 140], [298, 155], [310, 165], [305, 190],
      [295, 210], [285, 240], [270, 265], [255, 295], [240, 320], [220, 340], [205, 350], [180, 345], [150, 330],
      [120, 310], [100, 298], [80, 285], [60, 265], [52, 245], [60, 215], [75, 190], [90, 165], [105, 140], [118, 115],
      [135, 90],
    ],
  },
};

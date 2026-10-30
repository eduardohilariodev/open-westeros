// Major events of Westeros and Essos for the timeline (ui/housePanel.ts initWhen). Source: the wiki's "Timeline of major events"
// (A Wiki of Ice and Fire, CC BY-SA), which cites the novels, The World of Ice & Fire and Fire & Blood. Years count from Aegon's
// Conquest, negative before it (there is no year 0). `ca` marks a date the sources give as approximate; `to` ends a span.

export interface TimelineEvent { from: number; to?: number; ca?: boolean; title: string; text: string }

const ev = (from: number, to: number | null, title: string, text: string, ca = false): TimelineEvent => ({ from, ...(to != null && { to }), ...(ca && { ca }), title, text });

export const EVENTS: TimelineEvent[] = [
  ev(-12000, null, 'The First Men invade Westeros', 'The First Men cross the Arm of Dorne from Essos with bronze weapons. The children of the forest shatter the land bridge with the hammer of the waters, making the Broken Arm and the Stepstones, but cannot stop them. The First Men found hundreds of petty kingdoms.', true),
  ev(-10000, null, 'Signing of the Pact', 'After years of war the First Men and the children of the forest agree to live together on the Isle of Faces: the First Men keep the open land, the children the forests. In time the First Men take up the old gods.', true),
  ev(-10000, null, 'Age of Heroes', 'Named later for the great figures of the peace after the Pact: Brandon the Builder, Lann the Clever, Garth the Gardener, Durran Godsgrief and the Grey King. The Pact lasts nearly four thousand years.', true),
  ev(-8000, -6000, 'The Long Night', 'A generation-long winter. The Others march out of the far north, raising the dead, until the Battle for the Dawn, where the children and the First Men beat them with dragonglass. Azor Ahai and Lightbringer belong to this time. Believed to be between eight and six thousand years ago.', true),
  ev(-8000, null, 'Building of the Wall', 'With the Others beaten, Bran the Builder, with giants, the First Men and perhaps the children, raises the Wall, guarded by the Night\'s Watch. It is said he also builds Winterfell and founds House Stark.', true),
  ev(-8000, null, 'The Night\'s King', 'By legend the thirteenth Lord Commander took a pale woman as queen and ruled at the Nightfort for thirteen years, until King Brandon Stark and the wildling king Joramun cast him down. The maesters call it myth.', true),
  ev(-8000, -4700, 'Rise of the Valyrian Freehold', 'In Essos, sheep-herders of the Valyrian peninsula find dragons in the Fourteen Flames and tame them with magic. The Freehold is founded, with topless towers and swords of legendary steel.', true),
  ev(-8000, -4700, 'The Ghiscari wars', 'Five wars between the Old Empire of Ghis and the Freehold, all won by Valyria with its dragons. The Valyrians learn slavery from the Ghiscari.', true),
  ev(-6000, null, 'Foundation of the Faith; the coming of the Andals', 'In the hills of Andalos the Faith of the Seven takes shape. The Andals cross the narrow sea to the Fingers of the Vale with steel weapons and seven-pointed stars cut into their chests, and sweep the south as the First Men once did. Only the north holds, thanks to Moat Cailin. Sources date this six, four or two thousand years ago.', true),
  ev(-4700, null, 'Fifth Ghiscari War', 'Old Ghis is destroyed utterly: walls and streets burned with dragonflame, fields salted and sulfured. The Freehold spreads over the Slaver\'s Bay cities, and the Andals travel west to flee the Valyrians.', true),
  ev(-3700, null, 'The Andals take the Iron Islands', 'A thousand years after landing, the Andals end House Greyiron\'s rule of the Iron Islands, but take up the Old Way and the Drowned God.', true),
  ev(-3000, null, 'The six Andal kingdoms', 'The southern kingdoms of the First Men fall over the centuries, and the Andals raise six kingdoms of their own.', true),
  ev(-3000, null, 'Wildling invasion', 'The free folk unite under the brother Kings-beyond-the-Wall, Gendel and Gorne, slip past the Watch through tunnels under the Wall, and are thrown back by the King in the North.', true),
  ev(-1436, null, 'Lorath', 'Religious dissidents leave the Freehold and found a temple on Lorath\'s main isle, the start of the Free City.'),
  ev(-950, -700, 'The Rhoynish Wars', 'Valyria\'s westward growth brings war with the Rhoynish cities on the Rhoyne, from the First Turtle War to the Second Spice War, about two hundred and fifty years.', true),
  ev(-700, null, 'The Rhoynar migration', 'After Prince Garin the Great\'s army fails against the dragons, Queen Nymeria leads the survivors on ten thousand ships to Dorne. She weds Lord Mors Martell and together they unite Dorne under House Martell. The last major migration into Westeros.', true),
  ev(-700, null, 'House Stark subdues House Bolton', '"A thousand years ago" House Stark subdues House Bolton and ends flaying. Karlon Stark defeats a rebel lord and House Karstark descends from him.', true),
  ev(-400, null, 'Battle of Six Kings', 'House Teague falls and King Arlan III Durrandon of the stormlands annexes the riverlands.', true),
  ev(-314, null, 'Dragonstone', 'The Freehold annexes an island at the mouth of Blackwater Bay and builds a castle with dragon-shaped towers.', true),
  ev(-114, null, 'Migration of the Targaryens', 'After a prophetic dream of his daughter Daenys, Lord Aenar Targaryen leaves Valyria with his family and settles on Dragonstone.'),
  ev(-102, null, 'The Doom of Valyria', 'Volcanic and seismic upheaval, likely from the Fourteen Flames, shatters the peninsula and lays waste to Valyria. Its dragons are nearly all lost and the Freehold falls apart in the Century of Blood into the Free Cities and the cities of Slaver\'s Bay.'),
  ev(-100, null, 'Battle at Fairmarket', 'Harwyn Hoare conquers the riverlands from King Arrec Durrandon.', true),
  ev(-42, null, 'Harrenhal begun', 'Harren Hoare, King of the Isles and the Rivers, starts building Harrenhal, which takes forty years.', true),
  ev(-2, 1, 'Aegon\'s Conquest', 'Aegon the Conqueror invades Westeros and in two years unites six of the seven kingdoms, building King\'s Landing. Dorne stays independent. Orys Baratheon gets Storm\'s End, Harlan Tyrell Highgarden, Edmyn Tully is Lord Paramount of the Trident. His coronation in Oldtown is the first day of 1 AC.'),
  ev(2, 13, 'The Dragon\'s wars', 'Aegon invades the Iron Islands in 2 AC and Vickon Greyjoy becomes Lord of the Iron Islands. Queen Visenya ends the uprising of the Three Sisters. The Targaryens invade Dorne in 4 AC.'),
  ev(4, 13, 'First Dornish War', 'Aegon invades Dorne but the Dornishmen resist. His sister Rhaenys is presumed dead after disappearing at Hellholt.'),
  ev(13, 37, 'The Dragon\'s Peace', 'Peace in the realm until Aegon\'s death.'),
  ev(41, 48, 'The Faith Militant uprising', 'Aenys I angers the Faith by marrying his eldest daughter to his eldest son and dies in 42 AC. Maegor the Cruel takes the throne over Aenys\'s three sons, crushes the uprising with thousands dead, and fights Prince Aegon and later Prince Jaehaerys for the crown.'),
  ev(48, null, 'Jaehaerys the Conciliator', 'Jaehaerys I succeeds Maegor, ends the slaughter, and the Faith Militant disbands. Decades of peace follow.'),
  ev(49, null, 'The Year of the Three Brides', 'Three weddings: Rhaena Targaryen and Androw Farman; Lord Rogar Baratheon and Queen Regent Alyssa Velaryon; Jaehaerys I and his sister Alysanne.'),
  ev(54, null, 'The Year of the Stranger', 'A year of deaths and tragedies for House Targaryen and the Seven Kingdoms.'),
  ev(92, null, 'Choosing of 92 AC', 'After the death of Prince Aemon, Jaehaerys names his second son Baelon his heir over Aemon\'s daughter Rhaenys.'),
  ev(96, null, 'Rise of the Triarchy', 'Myr, Lys and Tyrosh ally after beating Volantis at the Battle of the Borderland. The Kingdom of the Three Daughters lasts decades and clashes with the Targaryens.'),
  ev(101, null, 'The Great Council of 101 AC', 'After Baelon\'s death the first Great Council chooses Prince Viserys over Rhaenys\'s son Laenor Velaryon.'),
  ev(106, 115, 'Conquest of the Stepstones', 'Prince Daemon Targaryen and Lord Corlys Velaryon take the Stepstones, drawing in the Triarchy and Dorne. Daemon names himself King of the Stepstones and the Narrow Sea in 109 AC and leaves in 115 AC to marry Laena Velaryon.'),
  ev(120, null, 'The Year of the Red Spring', 'Laena and Laenor Velaryon die, Prince Aemond loses an eye fighting Lucerys Velaryon, and a fire at Harrenhal kills Lord Lyonel Strong and his heir Ser Harwin. All feed into the Dance of the Dragons.'),
  ev(129, 131, 'The Dance of the Dragons', 'The first great civil war: Aegon II against his half-sister Rhaenyra over their father\'s throne. It consumes both and most of the Targaryens and their dragons, and ends with Rhaenyra\'s son crowned Aegon III. The Triarchy collapses in the Daughters\' War.'),
  ev(131, 136, 'The Regency of Aegon III', 'Seven regents rule through a five-year minority amid plots, a six-year winter and the Winter Fever. Bandits roam the realm, the Lannisters and Greyjoys fight on the west coast, the Vale fights a succession war, and the Daughters\' War spreads through the Free Cities.'),
  ev(153, null, 'Death of the last dragon', 'Aegon III cannot breed healthy dragons. The last one dies, earning him the name Dragonbane, and the eggs left behind never hatch.'),
  ev(157, 161, 'Conquest of Dorne', 'Daeron I conquers Dorne and leaves Lord Lyonel Tyrell to govern. The Dornishmen kill Lyonel; Daeron is killed under a peace banner and Prince Aemon the Dragonknight is captured. Baelor I goes to Dorne to negotiate. Daeron is said to have lost ten thousand men conquering Dorne and fifty thousand failing to hold it.'),
  ev(170, null, 'Prince Baelor and Daemon Waters born', 'Prince Daeron and Princess Myriah Martell have their son Baelor. Princess Daena Targaryen bears Aegon IV\'s bastard Daemon Waters, later Daemon I Blackfyre.'),
  ev(187, null, 'Dorne joins the Seven Kingdoms', 'Daenerys, King Daeron II\'s sister, weds Maron Martell, Prince of Dorne, who swears fealty to the Iron Throne.'),
  ev(196, null, 'The First Blackfyre Rebellion', 'Daemon I Blackfyre claims the throne on Daeron II\'s illegitimacy, marches on King\'s Landing and is beaten at the Redgrass Field, killed by his half-brother Brynden Rivers. Several of his sons escape to the Free Cities with Aegor Rivers.'),
  ev(209, null, 'The Hedge Knight', 'Prince Baelor is killed at the Ashford Meadow tourney. Months later Daeron II and Baelor\'s two sons die of the Great Spring Sickness and Aerys I becomes king. Prince Aegon becomes squire to the hedge knight Ser Duncan the Tall.'),
  ev(211, null, 'The Sworn Sword', 'Houses Osgrey and Webber of the Reach become allies. Brynden Rivers, Lord Bloodraven, is King\'s Hand, angering Prince Maekar.'),
  ev(211, null, 'The Second Blackfyre Rebellion', 'Blackfyre loyalists plot a rebellion at the wedding tourney at Whitewalls, but Bloodraven exposes the plan and the Pretender Daemon II Blackfyre. Many are executed before a battle is fought. Told in The Mystery Knight.'),
  ev(219, null, 'The Third Blackfyre Rebellion', 'Haegon I Blackfyre, Aegor Rivers and the Golden Company invade and Haegon is killed after surrendering. Aegor is freed by his men and crowns Haegon\'s son Daemon.'),
  ev(226, null, 'Raymun Redbeard', 'The free folk unite under King-Beyond-the-Wall Raymun Redbeard, scale the Wall and invade the north, until a Stark host under Lord Willam Stark stops them at the Battle of Long Lake.'),
  ev(233, null, 'Great Council of 233 AC', 'With no clear heir after Maekar I dies in the Peake Uprising, Bloodraven calls a Great Council. Aemon refuses the crown and goes to the Wall. Aenys Blackfyre is arrested and executed on arrival. Prince Aegon becomes Aegon V, the Unlikely. Bloodraven is exiled to the Wall and becomes Lord Commander in 239 AC.'),
  ev(236, null, 'The Fourth Blackfyre Rebellion', 'Daemon III Blackfyre and the Golden Company invade; he is slain by Ser Duncan the Tall of the Kingsguard. Also remembered as the Red Spring.'),
  ev(259, null, 'The tragedy of Summerhall', 'Aegon V and his eldest son Prince Duncan die in a great fire at Summerhall, set off by an attempt to hatch the last dragon eggs. It heralds the birth of Prince Rhaegar.'),
  ev(260, null, 'The War of the Ninepenny Kings', 'The Band of Nine, with Maelys Blackfyre, takes Tyrosh and the Stepstones and moves on the Seven Kingdoms. Ser Barristan Selmy kills Maelys. Prince Aerys is knighted by Ser Tywin Lannister, and Lord Ormund Baratheon dies at the hands of his son Ser Steffon.'),
  ev(261, null, 'Reyne-Tarbeck rebellion', 'Houses Reyne and Tarbeck rise against House Lannister and Ser Tywin obliterates both. Aerys II names him Hand the following year.'),
  ev(276, null, 'Birth of Prince Viserys', 'Queen Rhaella gives birth to a son who will survive infancy.'),
  ev(277, null, 'The Defiance of Duskendale', 'Lord Denys Darklyn refuses to pay taxes. Aerys II goes to Duskendale and is taken prisoner; after a six-month siege Ser Barristan Selmy frees him. Houses Darklyn and Hollard are destroyed. It begins Aerys\'s descent into madness.'),
  ev(280, null, 'Marriage of Rhaegar and Elia', 'Prince Rhaegar marries Princess Elia Martell in the Great Sept of Baelor. Their first child, Princess Rhaenys, is born at year\'s end.'),
  ev(281, null, 'Kingswood Brotherhood defeated', 'Ser Arthur Dayne defeats the outlaws. Jaime Lannister, a squire, is knighted and then named to the Kingsguard, and Tywin resigns as Hand in anger.'),
  ev(281, null, 'The Year of the False Spring', 'Lord Walter Whent\'s tourney at Harrenhal: Rhaegar names Lyanna Stark, betrothed to Robert Baratheon, queen of love and beauty. Eddard Stark meets Howland Reed.'),
  ev(282, 283, 'Robert\'s Rebellion', 'Rhaegar abducts Lyanna Stark; Aerys kills her father Rickard and brother Brandon and demands the heads of Robert and Eddard. Arryn, Stark, Baratheon and Tully rise. The royalists lose the Battle of the Bells and the Battle of the Trident, where Rhaegar dies. The Lannisters turn on Aerys in the Sack of King\'s Landing and Jaime kills him. Elia and her children are murdered by Gregor Clegane and Amory Lorch. At the tower of joy Eddard finds Lyanna dying. Robert is crowned and weds Cersei Lannister; Eddard brings Jon Snow home to Winterfell.'),
  ev(284, null, 'Assault on Dragonstone', 'Stannis Baratheon builds a fleet and takes Dragonstone. Queen Rhaella dies giving birth to Daenerys during a summer storm, and Ser Willem Darry takes Viserys and Daenerys to Braavos.'),
  ev(289, null, 'Greyjoy\'s Rebellion', 'Balon Greyjoy names himself King of the Iron Islands, loses and two sons die. Robert accepts his surrender and Theon becomes Eddard Stark\'s ward.'),
  ev(297, null, 'Illyrio takes in the Targaryens', 'Magister Illyrio Mopatis invites Viserys and Daenerys to his manse in Pentos and offers to help them win the Iron Throne. The Prologue of A Game of Thrones is set this year.'),
  ev(298, null, 'A Song of Ice and Fire begins', 'The Others return in an attack on Night\'s Watch rangers and free folk. Jon Arryn is poisoned after learning Robert\'s heirs are bastards, and after Robert\'s death the War of the Five Kings begins.'),
  ev(299, null, 'Beyond the Wall; Slaver\'s Bay', 'The Night\'s Watch leaves in force on a great ranging. In Essos, Daenerys, with three hatched dragons, conquers the cities of Slaver\'s Bay and frees their slaves.'),
  ev(300, null, 'Winter comes', 'After a decade-long summer and brief autumn winter engulfs Westeros. Prince Aegon Targaryen, long thought dead, lands in the stormlands with the Golden Company. Daenerys rules Meereen as queen.'),
];

/** The wiki's eras, as its section headings give them. Two lanes: Westeros (a) and the Freehold (b), which overlaps it. */
export interface Era { from: number; to: number; name: string; lane: 'a' | 'b' }
export const ERAS: Era[] = [
  { from: -12000, to: -10001, name: 'Dawn Age', lane: 'a' },
  { from: -10000, to: -6001, name: 'Age of Heroes · the Long Night', lane: 'a' },
  { from: -6000, to: -3001, name: 'Coming of the Andals', lane: 'a' },
  { from: -3000, to: -3, name: 'The Seven Kingdoms', lane: 'a' },
  { from: -2, to: 280, name: 'Targaryen Dynasty', lane: 'a' },
  { from: 281, to: 283, name: 'Fall of the Dragons', lane: 'a' },
  { from: 284, to: 297, name: 'King Robert\'s Reign', lane: 'a' },
  { from: 298, to: 300, name: 'A Song of Ice and Fire', lane: 'a' },
  { from: -8000, to: -102, name: 'Age of Valyria', lane: 'b' },
];

/** The years the wiki has a page of events for ("Years before/after Aegon's Conquest"): the only years the timeline turns through. */
export const YEAR_STOPS: number[] = [
  ...[12000, 10000, 8000, 6000, 4700, 4000, 2000, 1436, 950, 700, 400, 314, 114, 102, 54, 52, 47, 37, 29, 27, 25, 14, 9, 2, 1].map((y) => -y),
  1, 2, 4, 5, 9, 10, 12, 13, 37, 39, 41, 42, 43, 44, 45, 47, 48, 49, 50, 51, 52, 54, 56, 59, 60, 61, 83, 92, 99, 100,
  101, 103, 104, 105, 106, 111, 114, 120, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 160, 161, 184, 196,
  209, 211, 212, 219, 233, 236, 259, 260, 261, 262, 280, 281, 282, 283, 284, 285, 289, 290, 295, 297, 298, 299, 300,
];
export const WIKI_YEAR = (y: number) => `https://awoiaf.westeros.org/index.php/${Math.abs(y)}_${y < 0 ? 'BC' : 'AC'}`;

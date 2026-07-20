/**
 * Zwift world definitions and real-world extents for basemap positioning.
 * Stripped down for the virtualmap extension - only name matching and extents.
 */

const worldCourseDescs = [
    {courseId: 6 , name:'Watopia'       , nicename: 'Watopia'        , alias:["WATOPIA"]},
    {courseId: 2 , name:'Richmond'      , nicename: 'Richmond'       , alias:["RICHMOND"]},
    {courseId: 7 , name:'London'        , nicename: 'London'         , alias:["LONDON"]},
    {courseId: 8 , name:'NewYork'       , nicename: 'New York'       , alias:["NEWYORK"]},
    {courseId: 9 , name:'Innsbruck'     , nicename: 'Innsbruck'      , alias:["INNSBRUCK"]},
    {courseId: 10, name:'Bologna'       , nicename: 'Bologna'        , alias:["BOLOGNATT"]},
    {courseId: 11, name:'Yorkshire'     , nicename: 'Yorkshire'      , alias:["YORKSHIRE"]},
    {courseId: 12, name:'CritCity'      , nicename: 'Crit City'      , alias:["CRITCITY"]},
    {courseId: 13, name:'MakuriIslands' , nicename: 'Makuri Islands' , alias:["MAKURIISLANDS","MAKURI ISLANDS"]},
    {courseId: 14, name:'France'        , nicename: 'France'         , alias:["FRANCE"]},
    {courseId: 15, name:'Paris'         , nicename: 'Paris'          , alias:["PARIS"]},
    {courseId: 16, name:'GravelMountain', nicename: 'Gravel Mountain', alias:["GRAVEL MOUNTAIN"]},
    {courseId: 17, name:'Scotland'      , nicename: 'Scotland'       , alias:["SCOTLAND"]}
];

/** Real-world bounding boxes keyed by courseId */
const extents = {
    6:  { west: 166.8582822917974511, south: -11.7312725092965522, east: 167.0323475888833116, north: -11.5301925484373324 },
    2:  { west: -77.4894625449863952, south: 37.5013345513645007,  east: -77.3940746451506953, north: 37.5774847325012900 },
    7:  { west: -0.1779572166905335,  south: 51.4602057809166666,  east: -0.0549519957274667,  north: 51.5362912271761999 },
    8:  { west: -74.0231736996073266, south: 40.5879274329999973,  east: -73.9217427820929487, north: 40.8172862460000019 },
    9:  { west: 11.3505176965529841,  south: 47.2055101222955429,  east: 11.4818528705013261,  north: 47.2947204710438456 },
    10: { west: 11.2631407831455288,  south: 44.4558841598698464,  east: 11.3694520115126387,  north: 44.5297800782955662 },
    11: { west: -1.6321125575047646,  south: 53.9490777310150662,  east: -1.5022952867656718,  north: 54.0254658411988800 },
    12: { west: 165.7822255393468538, south: -10.4039017994063876, east: 165.8208579953937374, north: -10.3655699850407892 },
    13: { west: 165.7660817581687240, south: -10.8522948255634812, east: 165.8821851584712022, north: -10.7374319666921050 },
    14: { west: 166.1384065150539584, south: -21.7563981850795471, east: 166.2612071527265698, north: -21.6416256294223821 },
    15: { west: 2.2852589593871078,   south: 48.8488074758116255,  east: 2.4008467381639997,   north: 48.9242851037263478 },
    16: { west: 165.8122939889705094, south: -10.3753808033444823, east: 165.8316669399062562, north: -10.3564566466389145 },
    17: { west: -5.2798456326195886,  south: 55.6185265339680868,  east: -5.1783887129207677,  north: 55.6758953713463782 }
};

function findWorldCourse(searchString) {
    if (!searchString) return null;
    const searchUpper = searchString.toUpperCase().trim();
    return worldCourseDescs.find(world =>
        world.name.toUpperCase() === searchUpper ||
        world.nicename.toUpperCase() === searchUpper ||
        world.alias.some(alias => alias === searchUpper)
    );
}

function extentsFromName(worldName) {
    const world = worldCourseDescs.find(a => a.nicename === worldName || a.name === worldName);
    if (!world) return null;
    const ext = extents[world.courseId];
    if (!ext) return null;
    return [
        [ext.north, ext.west],  // NW corner
        [ext.south, ext.east],  // SE corner
        [(ext.north + ext.south) / 2, (ext.west + ext.east) / 2] // midpoint
    ];
}

window.locationlib = {
    worldCourseDescs,
    findWorldCourse,
    extentsFromName
};

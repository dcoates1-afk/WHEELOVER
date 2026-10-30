/**
 * COLREGs study reference.
 *
 * These are plain-language summaries of the International Regulations for
 * Preventing Collisions at Sea, 1972 (as amended), kept offline with the app.
 * They are not a substitute for the official text — the source links and the
 * regional notes below point at the authoritative documents.
 */
export interface ColregRule {
  id: string;
  part: string;
  rule: string;
  title: string;
  summary: string;
  tags: string[];
}

export interface RegionalNote {
  id: 'us' | 'canada' | 'europe';
  title: string;
  authority: string;
  source: string;
  points: string[];
}

export const COLREGS: ColregRule[] = [
  {
    id: 'r1',
    part: 'Part A — General',
    rule: 'Rule 1',
    title: 'Application',
    summary:
      'The Rules apply to all vessels on the high seas and in waters navigable by seagoing vessels. Special rules may be made by local authorities for harbours, rivers and inland waters, provided they conform as closely as possible to the COLREGs.',
    tags: ['application', 'inland', 'scope'],
  },
  {
    id: 'r3',
    part: 'Part A — General',
    rule: 'Rule 3',
    title: 'General definitions',
    summary:
      'Defines vessel, power-driven vessel, sailing vessel, vessel not under command, vessel restricted in her ability to manoeuvre, vessel constrained by draught, underway, restricted visibility and “in sight”. A vessel is underway when she is not at anchor, made fast to the shore, or aground.',
    tags: ['definitions', 'not under command', 'underway', 'visibility'],
  },
  {
    id: 'r5',
    part: 'Part B — Steering and Sailing',
    rule: 'Rule 5',
    title: 'Look-out',
    summary:
      'Every vessel shall at all times maintain a proper look-out by sight and hearing, as well as by all available means appropriate to the prevailing circumstances, so as to make a full appraisal of the situation and risk of collision.',
    tags: ['lookout', 'watch', 'risk'],
  },
  {
    id: 'r6',
    part: 'Part B — Steering and Sailing',
    rule: 'Rule 6',
    title: 'Safe speed',
    summary:
      'Every vessel shall proceed at a safe speed so that she can take proper and effective action to avoid collision and stop within a distance appropriate to the prevailing circumstances, including visibility, traffic density, manoeuvrability, sea state and draught.',
    tags: ['speed', 'visibility', 'traffic'],
  },
  {
    id: 'r7',
    part: 'Part B — Steering and Sailing',
    rule: 'Rule 7',
    title: 'Risk of collision',
    summary:
      'Use all available means to determine risk, including a compass bearing of an approaching vessel. A steady bearing with decreasing range indicates risk; do not assume no risk when a large vessel or tow is involved, or when a bearing is closing slowly.',
    tags: ['risk', 'bearing', 'collision'],
  },
  {
    id: 'r8',
    part: 'Part B — Steering and Sailing',
    rule: 'Rule 8',
    title: 'Action to avoid collision',
    summary:
      'Any action must be positive, made in ample time and with due regard to good seamanship. Alteration of course or speed should be large enough to be readily apparent; avoid small succession of alterations. If necessary, slacken speed or stop. Action to avoid collision must not result in another close-quarters situation.',
    tags: ['avoidance', 'course', 'speed'],
  },
  {
    id: 'r9',
    part: 'Part B — Steering and Sailing',
    rule: 'Rule 9',
    title: 'Narrow channels',
    summary:
      'Keep as near to the outer limit of the channel on your starboard side as is safe and practicable. A vessel under 20 m, a sailing vessel or a vessel engaged in fishing shall not impede a vessel that can safely navigate only within the channel. Avoid anchoring in a narrow channel.',
    tags: ['narrow channel', 'fairway', 'impede'],
  },
  {
    id: 'r10',
    part: 'Part B — Steering and Sailing',
    rule: 'Rule 10',
    title: 'Traffic separation schemes',
    summary:
      'Use the appropriate traffic lane in the general direction of traffic flow, keep clear of the separation zone, and cross on a heading as nearly as practicable at right angles to the flow. Do not use inshore traffic zones unless justified; fishing vessels, sailing vessels and small vessels must not impede power-driven vessels following a lane.',
    tags: ['TSS', 'traffic lane', 'separation zone', 'crossing'],
  },
  {
    id: 'r11',
    part: 'Part B — Steering and Sailing',
    rule: 'Rule 11',
    title: 'Application (sections)',
    summary:
      'Rules in Section II (conduct of vessels in sight of one another) apply to vessels in sight of one another; Section III applies in restricted visibility. Where both could apply, the in-sight rules take precedence.',
    tags: ['sections', 'in sight', 'visibility'],
  },
  {
    id: 'r12',
    part: 'Part B — Steering and Sailing',
    rule: 'Rule 12',
    title: 'Sailing vessels',
    summary:
      'When two sailing vessels are approaching so as to involve risk of collision: wind on different sides — the vessel with the wind on her port side gives way; same side — the windward vessel gives way; vessel with wind on port side unsure — treat the other as windward and give way.',
    tags: ['sailing', 'windward', 'port tack'],
  },
  {
    id: 'r13',
    part: 'Part B — Steering and Sailing',
    rule: 'Rule 13',
    title: 'Overtaking',
    summary:
      'Any vessel overtaking any other shall keep out of the way of the vessel being overtaken. A vessel is overtaking when coming up from more than 22.5° abaft the other’s beam; if in doubt it is deemed overtaking. The overtaken vessel keeps her course and speed.',
    tags: ['overtaking', 'give way', 'stand on'],
  },
  {
    id: 'r14',
    part: 'Part B — Steering and Sailing',
    rule: 'Rule 14',
    title: 'Head-on situation',
    summary:
      'When two power-driven vessels are meeting on reciprocal or nearly reciprocal courses so as to involve risk of collision, each shall alter course to starboard so that each passes on the port side of the other.',
    tags: ['head on', 'starboard', 'power driven'],
  },
  {
    id: 'r15',
    part: 'Part B — Steering and Sailing',
    rule: 'Rule 15',
    title: 'Crossing situation',
    summary:
      'When two power-driven vessels are crossing so as to involve risk of collision, the vessel which has the other on her own starboard side shall keep out of the way and, if the circumstances admit, avoid crossing ahead of the other.',
    tags: ['crossing', 'give way', 'starboard'],
  },
  {
    id: 'r16',
    part: 'Part B — Steering and Sailing',
    rule: 'Rule 16',
    title: 'Action by give-way vessel',
    summary:
      'The give-way vessel shall, so far as possible, take early and substantial action to keep well clear. A series of small alterations does not satisfy this rule.',
    tags: ['give way', 'action'],
  },
  {
    id: 'r17',
    part: 'Part B — Steering and Sailing',
    rule: 'Rule 17',
    title: 'Action by stand-on vessel',
    summary:
      'The stand-on vessel keeps her course and speed, but may take action to avoid collision as soon as it becomes apparent that the give-way vessel is not taking appropriate action. If collision cannot be avoided by the give-way vessel alone, the stand-on vessel shall take the best avoiding action — she shall not alter course to port for a vessel on her own port side.',
    tags: ['stand on', 'avoidance', 'port'],
  },
  {
    id: 'r18',
    part: 'Part B — Steering and Sailing',
    rule: 'Rule 18',
    title: 'Responsibilities between vessels',
    summary:
      'Power-driven vessels keep out of the way of vessels not under command, restricted in ability to manoeuvre, engaged in fishing, and sailing vessels (with exceptions). Sailing vessels keep out of the way of fishing vessels and vessels not under command; all keep clear of vessels constrained by draught.',
    tags: ['hierarchy', 'fishing', 'sailing', 'NUC', 'RAM'],
  },
  {
    id: 'r19',
    part: 'Part B — Steering and Sailing',
    rule: 'Rule 19',
    title: 'Restricted visibility',
    summary:
      'In or near areas of restricted visibility, proceed at a safe speed adapted to the circumstances and reduced visibility. A power-driven vessel shall have her engines ready for immediate manoeuvre. Avoid altering course to port for a vessel forward of the beam (except when overtaking), and avoid altering course towards a vessel abeam or abaft the beam.',
    tags: ['fog', 'restricted visibility', 'safe speed'],
  },
  {
    id: 'r20',
    part: 'Part C — Lights and Shapes',
    rule: 'Rule 20',
    title: 'Application',
    summary:
      'Rules concerning lights apply from sunset to sunrise and in restricted visibility, and at all other times when deemed necessary. Lights must be exhibited so that they are visible from the prescribed arcs.',
    tags: ['lights', 'sunset', 'visibility'],
  },
  {
    id: 'r21',
    part: 'Part C — Lights and Shapes',
    rule: 'Rule 21',
    title: 'Definitions of lights',
    summary:
      'Masthead light: white, 225° forward arc. Sidelights: red to port 112.5°, green to starboard 112.5°. Sternlight: white 135° aft. Towing light: yellow 135°. All-round light: 360°. Flashing light: at least 120 flashes per minute.',
    tags: ['masthead', 'sidelight', 'sternlight', 'arcs'],
  },
  {
    id: 'r22',
    part: 'Part C — Lights and Shapes',
    rule: 'Rule 22',
    title: 'Visibility of lights',
    summary:
      'Minimum visible ranges: vessels 50 m or more — masthead 6 miles, sidelights 3 miles, sternlight 3 miles; vessels 12–50 m — masthead 5 miles (3 miles under 20 m), sidelights 2 miles, stern 2 miles; smaller vessels — 2 miles / 1 mile as applicable.',
    tags: ['visibility range', 'distance'],
  },
  {
    id: 'r23',
    part: 'Part C — Lights and Shapes',
    rule: 'Rule 23',
    title: 'Power-driven vessels underway',
    summary:
      'Show a masthead light forward, a second masthead light abaft and higher (vessels 50 m+), sidelights, and a sternlight. A vessel under 12 m may show an all-round white light and sidelights; under 7 m and 7 knots, an all-round white light and, if practicable, sidelights.',
    tags: ['power driven', 'lights'],
  },
  {
    id: 'r24',
    part: 'Part C — Lights and Shapes',
    rule: 'Rule 24',
    title: 'Towing and pushing',
    summary:
      'A power-driven vessel towing astern shows two masthead lights in a vertical line (three if tow exceeds 200 m), sidelights and a sternlight, plus a yellow towing light and a diamond shape if the tow exceeds 200 m. The towed vessel shows sidelights and a sternlight.',
    tags: ['towing', 'yellow light', 'diamond'],
  },
  {
    id: 'r25',
    part: 'Part C — Lights and Shapes',
    rule: 'Rule 25',
    title: 'Sailing vessels and vessels under oars',
    summary:
      'A sailing vessel underway shows sidelights and a sternlight; it may carry two all-round lights in a vertical line (red over green) at the masthead. A vessel under oars may show the same lights but, if not, must have a white light ready to prevent collision. Sailing vessels may also show a red over green all-round light.',
    tags: ['sailing', 'oars', 'lights'],
  },
  {
    id: 'r26',
    part: 'Part C — Lights and Shapes',
    rule: 'Rule 26',
    title: 'Fishing vessels',
    summary:
      'Trawling: two all-round lights in a vertical line, green over white, plus a masthead light abaft. Fishing other than trawling: red over white. A vessel with gear extending more than 150 m shows an all-round white light in the direction of the gear. Fishing vessels show two cones, apexes together.',
    tags: ['fishing', 'trawling', 'cones'],
  },
  {
    id: 'r27',
    part: 'Part C — Lights and Shapes',
    rule: 'Rule 27',
    title: 'Not under command / restricted ability',
    summary:
      'Not under command: two all-round red lights in a vertical line, and two balls in a vertical line by day. Restricted in ability to manoeuvre: red-white-red all-round lights, and a ball-diamond-ball by day. A vessel constrained by draught shows three all-round red lights vertically.',
    tags: ['NUC', 'RAM', 'constrained by draught', 'shapes'],
  },
  {
    id: 'r28',
    part: 'Part C — Lights and Shapes',
    rule: 'Rule 28',
    title: 'Vessels constrained by draught',
    summary:
      'A power-driven vessel constrained by her draught may, in addition to lights for a power-driven vessel underway, exhibit three all-round red lights in a vertical line, or a cylinder by day.',
    tags: ['draught', 'cylinder'],
  },
  {
    id: 'r30',
    part: 'Part C — Lights and Shapes',
    rule: 'Rule 30',
    title: 'Anchored and aground vessels',
    summary:
      'At anchor: an all-round white light forward and, if 50 m or more, a second all-round white light aft; by day one black ball forward. Aground: anchor lights plus two all-round red lights vertically, and three balls by day.',
    tags: ['anchor', 'aground', 'ball'],
  },
  {
    id: 'r32',
    part: 'Part D — Sound and Light Signals',
    rule: 'Rule 32',
    title: 'Definitions',
    summary:
      '“Whistle” means any sound-signalling appliance capable of the prescribed blasts. “Short blast” is about one second; “prolonged blast” is four to six seconds.',
    tags: ['whistle', 'blast', 'sound'],
  },
  {
    id: 'r33',
    part: 'Part D — Sound and Light Signals',
    rule: 'Rule 33',
    title: 'Equipment for sound signals',
    summary:
      'Vessels 12 m or more carry a whistle; 20 m or more also carry a bell; 100 m or more also carry a gong. A vessel under 12 m is not obliged to carry sound-signalling appliances but must be able to make an efficient sound signal.',
    tags: ['whistle', 'bell', 'gong'],
  },
  {
    id: 'r34',
    part: 'Part D — Sound and Light Signals',
    rule: 'Rule 34',
    title: 'Manoeuvring and warning signals',
    summary:
      'One short blast — altering to starboard; two — to port; three — operating astern propulsion. When in sight, these are accompanied by the corresponding light flashes. Doubt or danger: at least five short and rapid blasts. Approaching a bend or obstruction: one prolonged blast.',
    tags: ['manoeuvring', 'blasts', 'doubt'],
  },
  {
    id: 'r35',
    part: 'Part D — Sound and Light Signals',
    rule: 'Rule 35',
    title: 'Sound signals in restricted visibility',
    summary:
      'Power-driven vessel making way: one prolonged blast at intervals of not more than 2 minutes. Stopped: two prolonged blasts with an interval between them. Not under command, restricted, sailing, fishing or towing: one prolonged followed by two short blasts. Anchored: rapid ringing of the bell for 5 seconds at intervals of not more than 1 minute.',
    tags: ['fog signals', 'visibility', 'bell'],
  },
  {
    id: 'r36',
    part: 'Part D — Sound and Light Signals',
    rule: 'Rule 36',
    title: 'Signals to attract attention',
    summary:
      'If necessary to attract the attention of another vessel, any vessel may make light or sound signals that cannot be mistaken for an authorised signal, or may direct the beam of her searchlight in the direction of the danger, without embarrassing any other vessel.',
    tags: ['attention', 'searchlight'],
  },
  {
    id: 'r37',
    part: 'Part D — Sound and Light Signals',
    rule: 'Rule 37',
    title: 'Distress signals',
    summary:
      'When in distress, a vessel uses the signals in Annex IV: gun fired at intervals of about a minute, continuous fog-signalling, rockets or shells throwing red stars, SOS by any method, spoken “MAYDAY”, NC flags, square flag with a ball, flames, dye markers, or arms raised and lowered slowly.',
    tags: ['distress', 'mayday', 'annex IV'],
  },
  {
    id: 'r38',
    part: 'Part E — Exemptions',
    rule: 'Rule 38',
    title: 'Exemptions',
    summary:
      'Vessels (or classes of vessels) whose keels were laid before the entry into force of the Rules may be exempted from certain light and sound requirements, subject to the certificates issued by the Administration.',
    tags: ['exemptions', 'older vessels'],
  },
  {
    id: 'r40',
    part: 'Part E — Exemptions',
    rule: 'Rule 40',
    title: 'Entry into force',
    summary:
      'The 1972 Regulations entered into force on 15 July 1977. Subsequent amendments (1981, 1987, 1989, 1993, 2001, 2007, 2013, 2016) updated lights, signals and definitions.',
    tags: ['history', 'amendments'],
  },
  {
    id: 'annex1',
    part: 'Annexes',
    rule: 'Annex I',
    title: 'Positioning and technical details of lights',
    summary:
      'Sets out vertical and horizontal positioning of lights, screens, colour specifications and the intensities needed to achieve the required visibility ranges.',
    tags: ['annex', 'technical', 'lights'],
  },
  {
    id: 'annex4',
    part: 'Annexes',
    rule: 'Annex IV',
    title: 'Distress signals',
    summary:
      'Lists the internationally recognised distress signals, including MAYDAY by radiotelephony, SOS by radiotelegraphy, red parachute flares, hand flares, smoke and the square flag with a ball.',
    tags: ['annex', 'distress', 'flares'],
  },
];

export const REGIONAL_NOTES: RegionalNote[] = [
  {
    id: 'us',
    title: 'United States — Inland Rules and COLREGs demarcation',
    authority: 'US Coast Guard / 33 CFR 83 and 84',
    source: 'https://www.ecfr.gov/current/title-33/chapter-I/subchapter-E',
    points: [
      'Inside the COLREGs demarcation lines the Inland Navigation Rules (33 CFR 83) apply; outside them the international COLREGs apply. The demarcation lines are drawn at harbour entrances and river mouths.',
      'Inland Rule 9 (narrow channels) is stricter than the international rule: smaller power-driven vessels and sailing vessels must not impede a vessel that can only safely navigate within the channel.',
      'Inland Rule 34 adds the “danger signal” of five short blasts and uses the same manoeuvring signals; Great Lakes and Western Rivers have additional whistle signals under 33 CFR 83.34 and local general rules.',
      'US inland waters use IALA Region B buoyage: green is kept to port and red to starboard when entering from seaward.',
      'The USCG publishes the current rules and local notices; always check the Local Notice to Mariners for the area.',
    ],
  },
  {
    id: 'canada',
    title: 'Canada — Collision Regulations (TP 14202)',
    authority: 'Transport Canada / Canada Shipping Act, 2001',
    source: 'https://tc.canada.ca/en/marine-transportation/marine-safety/collision-regulations',
    points: [
      'Canada applies the Collision Regulations (CRC, c. 1416), which adopt the COLREGs with Canadian modifications, including the Great Lakes and Arctic Waters.',
      'Canadian modifications include additional requirements for sounding signals and radar use in restricted visibility, and specific rules for the Great Lakes and their connecting waters.',
      'The Canadian buoyage system follows IALA Region B (red to starboard returning upstream from seaward), with Canadian adaptations for the St. Lawrence and Great Lakes.',
      'Pleasure craft are also bound by the Small Vessel Regulations; operator competency is a legal requirement.',
    ],
  },
  {
    id: 'europe',
    title: 'Europe — CEVNI and national variations',
    authority: 'UNECE (CEVNI) and national maritime administrations',
    source: 'https://unece.org/transport/standards/cevni',
    points: [
      'At sea, EU and UK waters apply the COLREGs directly; national administrations publish guidance, harbour bylaws and local notices in addition.',
      'Inland waterways use CEVNI (European Code for Inland Waterways), which has its own lights, shapes and signals and is not the COLREGs; CEVNI also applies on some estuary and canal systems.',
      'Buoyage is IALA Region A in Europe: red to port, green to starboard entering from seaward; the lateral colours are the reverse of Region B.',
      'Inland waterway certificates and radar/CEVNI endorsements may be required; check the relevant national authority (for example the UK MCA, France’s VNF, Germany’s BSH/WSV).',
      'National deviations and byelaws (harbour speed limits, VHF reporting schemes, TSS reporting) take precedence locally.',
    ],
  },
];

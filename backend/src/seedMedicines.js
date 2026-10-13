// HWH Pharmacy product master, taken from the shelf list the pharmacy kept in
// its old system ("Medicines Names - HWH Pharmacy.xls"). The list is grouped by
// company, and each line carries the old system's dosage-form prefix:
//
//   Abbott
//     Tab.  Brufen 400mg
//     Syp.  Brufen 90ml
//
// The data file keeps those lines as they were written; the mapping from prefix
// to product type lives here, where it can be read and corrected.
//
// Catalogue only: no prices, no packaging and no stock were in the list. Prices
// are entered from the product screen and stock arrives through goods receipt,
// which is where the batch and expiry a medicine needs are captured anyway.
const GROUPS = require('./data/hwh-medicines.json');

// prefix -> [product type, base unit override]. A null unit takes the type's
// default unit.
const PREFIX = {
  'Tab': ['Tablet'], 'Cap': ['Capsule'],
  'Syp': ['Syrup'], 'Syr': ['Syrup'],
  // Liquids and solutions in the list are a mix of medicines (enemas, neb
  // solutions, ORS) and sundries (spirit, hand wash). There is no "solution"
  // type, so they go in as a bottled medicine: an unknown item demanding a batch
  // on receipt is an annoyance, real medicine received without one is not.
  'Liq': ['Syrup'], 'Sol': ['Syrup'],
  'Inj': ['Injection'], 'I.v': ['IV infusion'],
  'Dro': ['Drops'], 'Spr': ['Drops'],
  'Cre': ['Ointment / Cream'], 'Oin': ['Ointment / Cream'], 'Gel': ['Ointment / Cream'],
  'Lot': ['Ointment / Cream', 'bottle'],
  'Sac': ['Sachet'], 'Pow': ['Sachet', 'pack'],
  'Inh': ['Inhaler'],
  'Sti': ['Diagnostic / Test strip'],
  'Ban': ['Dressing'], 'Col': ['Dressing'],
  'Sur': ['Surgical / Disposable'], 'Pla': ['Surgical / Disposable'], 'Dis': ['Surgical / Disposable'],
  'Cer': ['Surgical / Disposable'], 'Nee': ['Surgical / Disposable'], 'Set': ['Surgical / Disposable'],
  'S.t': ['Surgical / Disposable'], 'Pep': ['Surgical / Disposable'], 'Neb': ['Surgical / Disposable'],
  'Cat': ['Surgical / Disposable'], 'Ett': ['Surgical / Disposable'], 'B.r': ['Surgical / Disposable'],
  'Sal': ['Cosmetic'], 'Soa': ['Cosmetic'], 'Bru': ['Cosmetic'], 'Pas': ['Cosmetic'],
  'Mil': ['Nutrition'],
  '-': ['General item'],
};

// Company headings in the list that are shelf sections, not manufacturers.
const NOT_A_MANUFACTURER = new Set(['Miscellaneous', 'Dispensing', 'Surgical Disposable']);

// Dose only: "5/40mg", "250mg/5ml", "0.05%". A bare "60ml" or "20gm" is the
// pack size, not the strength, and is left in the name only.
const STRENGTH = /(?:\d+(?:\.\d+)?\/)*\d+(?:\.\d+)?\s*(?:mcg|mg|iu|%)(?:\s*\/\s*\d*(?:\.\d+)?\s*ml)?(?![a-z])/i;

function parseLine(line) {
  const m = line.match(/^([A-Za-z.\-]{1,5}?)\.\s+(.*)$/);
  const prefix = m ? m[1] : null;
  // The old system padded names with trailing dots and stray quotes.
  const name = (m ? m[2] : line).replace(/[\s."]+$/, '').replace(/\s+/g, ' ').trim();
  let [type, unit] = PREFIX[prefix] || ['General item'];
  // Glycerine suppositories were filed under Gel.
  if (/supo/i.test(name)) [type, unit] = ['Suppository'];
  return { name, type, unit };
}

// Inserts every product in the list that is not already in the catalogue.
// Safe to run again: a product is matched by its SKU, and by name + type so a
// medicine an administrator already entered by hand is not duplicated.
function seedHwhMedicines(db) {
  const types = {};
  for (const t of db.prepare('SELECT id, name, is_medicine, default_tax_pct, default_schedule, default_unit FROM product_types').all()) {
    types[t.name] = t;
  }
  const insMaker = db.prepare('INSERT INTO manufacturers (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
  const getMaker = db.prepare('SELECT id, name FROM manufacturers WHERE name = ?');
  const exists = db.prepare(
    'SELECT 1 FROM products WHERE sku = @sku OR (lower(name) = lower(@name) AND product_type_id = @type_id) LIMIT 1'
  );
  const insProd = db.prepare(
    `INSERT INTO products
       (sku, name, form, unit, strength, units_per_strip, strips_per_box, allow_loose, pack_size,
        is_otc, drug_schedule, sale_price, tax_pct, manufacturer, product_type_id, manufacturer_id)
     VALUES
       (@sku, @name, @form, @unit, @strength, 1, 1, 1, 1,
        @is_otc, @drug_schedule, 0, @tax_pct, @manufacturer, @product_type_id, @manufacturer_id)`
  );

  let seq = 0;
  let added = 0;
  for (const group of GROUPS) {
    let maker = null;
    if (group.manufacturer && !NOT_A_MANUFACTURER.has(group.manufacturer)) {
      insMaker.run(group.manufacturer);
      maker = getMaker.get(group.manufacturer);
    }
    for (const line of group.items) {
      seq += 1;
      const p = parseLine(line);
      const type = types[p.type];
      if (!type) throw new Error(`seedHwhMedicines: product type "${p.type}" is missing`);
      const sku = `HWH-${String(seq).padStart(4, '0')}`;
      if (exists.get({ sku, name: p.name, type_id: type.id })) continue;
      const strength = type.is_medicine ? (p.name.match(STRENGTH) || [null])[0] : null;
      insProd.run({
        sku,
        name: p.name,
        form: type.name,
        unit: p.unit || type.default_unit || 'unit',
        strength: strength ? strength.replace(/\s+/g, '') : null,
        is_otc: type.default_schedule === 'OTC' ? 1 : 0,
        drug_schedule: type.default_schedule,
        tax_pct: type.default_tax_pct,
        manufacturer: maker ? maker.name : null,
        product_type_id: type.id,
        manufacturer_id: maker ? maker.id : null,
      });
      added += 1;
    }
  }
  return { total: seq, added };
}

module.exports = { seedHwhMedicines, parseLine };

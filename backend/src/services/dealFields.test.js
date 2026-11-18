import { createFakeSupabase } from '../test/fakeSupabase.js';
import { customFieldMapping, loadDealFields, validateCustomFieldValues, validateDealFields } from './dealFields.js';

const fields = [
  { id: 'region', label: 'Region', type: 'text', active: true },
  { id: 'renewal-date', label: 'Renewal date', type: 'date', active: true },
  { id: 'visits', label: 'Visits', type: 'number', active: true },
  { id: 'priority', label: 'Priority customer', type: 'boolean', active: true },
];

describe('validateDealFields', () => {
  test('keeps supported company field definitions and defaults new fields to active', () => {
    expect(validateDealFields([{ id: 'region', label: ' Region ', type: 'text' }])).toEqual({
      fields: [{ id: 'region', label: 'Region', type: 'text', active: true }],
    });
  });

  test('rejects duplicate labels and unsupported types', () => {
    expect(validateDealFields([
      { id: 'region', label: 'Region', type: 'text' },
      { id: 'area', label: ' region ', type: 'text' },
    ]).error).toMatch(/used more than once/);
    expect(validateDealFields([{ id: 'region', label: 'Region', type: 'currency' }]).error).toMatch(/unsupported type/);
  });

  test('keeps the creation limit but allows valid legacy fields to be read', async () => {
    const savedFields = Array.from({ length: 21 }, (_, index) => ({
      id: `field-${index}`,
      label: `Field ${index}`,
      type: 'text',
      active: true,
    }));
    const db = createFakeSupabase({ companies: [{ id: 'co-1', deal_fields: savedFields }] });

    expect(validateDealFields(savedFields).error).toMatch(/no more than 20 items/);
    await expect(loadDealFields(db, 'co-1')).resolves.toEqual(savedFields);
  });
});

describe('validateCustomFieldValues', () => {
  test('validates and normalizes values by the configured field type', () => {
    expect(validateCustomFieldValues({
      region: '  Coast ',
      'renewal-date': '2027-02-28',
      visits: '3',
      priority: false,
    }, fields)).toEqual({
      values: { region: 'Coast', 'renewal-date': '2027-02-28', visits: 3, priority: false },
    });
  });

  test('rejects unknown, malformed, or hidden field values', () => {
    expect(validateCustomFieldValues({ surprise: 'x' }, fields).error).toMatch(/Unknown custom field/);
    expect(validateCustomFieldValues({ visits: 'often' }, fields).error).toMatch(/must be a number/);
    expect(validateCustomFieldValues({ visits: false }, fields).error).toMatch(/must be a number/);
    expect(validateCustomFieldValues({ 'renewal-date': '2027-02-30' }, fields).error).toMatch(/real date/);
    expect(validateCustomFieldValues({ region: 'Coast' }, [{ ...fields[0], active: false }]).error).toMatch(/Unknown custom field/);
  });
});

test('prefixes a custom field id for column mappings', () => {
  expect(customFieldMapping('region')).toBe('custom:region');
});

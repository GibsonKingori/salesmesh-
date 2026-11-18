import { upsertRows } from './postgresClient.js';

test('serializes JSON arrays as JSON when mirroring company fields', async () => {
  const fields = [{ id: 'region', label: 'Region', type: 'text', active: true }];
  let queryValues;
  const client = {
    async query(_sql, values) {
      queryValues = values;
    },
  };

  await upsertRows('companies', [{ id: 'co-1', deal_fields: fields }], client);

  expect(queryValues).toEqual(['co-1', JSON.stringify(fields)]);
});

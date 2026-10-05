const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const constantsSource = fs.readFileSync(
  path.join(__dirname, '../src/config/constants.js'),
  'utf8',
);

const loadConstants = (env) => {
  const module = { exports: {} };
  vm.runInNewContext(constantsSource, { module, process: { env } });
  return module.exports;
};

test('institute emails use the public portal instead of the second CORS origin', () => {
  const config = loadConstants({
    FRONTEND_URL:
      ' https://cadet.molminavis.com/ , http://localhost:3001 , http://192.168.1.13:3001 ',
  });

  assert.equal(config.FRONTEND_URL, 'https://cadet.molminavis.com');
  assert.equal(
    config.INSTITUTE_LOGIN_URL,
    'https://cadet.molminavis.com/institute-login',
  );
});

test('a single configured portal URL supplies the institute login URL', () => {
  const config = loadConstants({ FRONTEND_URL: 'https://cadet.molminavis.com' });

  assert.equal(
    config.INSTITUTE_LOGIN_URL,
    'https://cadet.molminavis.com/institute-login',
  );
});

test('an explicit institute login URL remains supported', () => {
  const config = loadConstants({
    FRONTEND_URL: 'https://cadet.molminavis.com',
    INSTITUTE_LOGIN_URL: ' https://institute.example.com/institute-login/ ',
  });

  assert.equal(
    config.INSTITUTE_LOGIN_URL,
    'https://institute.example.com/institute-login',
  );
});

test('unconfigured development uses the local portal default', () => {
  const config = loadConstants({});

  assert.equal(config.FRONTEND_URL, 'http://localhost:3000');
  assert.equal(config.INSTITUTE_LOGIN_URL, 'http://localhost:3000/institute-login');
});

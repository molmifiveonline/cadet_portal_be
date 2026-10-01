const test = require('node:test');
const assert = require('node:assert/strict');
const { emailTemplates } = require('../src/services/emailService');

test('re-upload email lists only requested documents and their remarks', () => {
  const { subject, html } = emailTemplates.documentStatusReport({
    recipientName: 'TechGuru Institute',
    cadetName: 'Demo Deck Cadet 06',
    requiresReupload: true,
    onedriveLink: 'https://example.com/upload?cadet=06&drive=demo',
    documents: [
      { document_name: 'CV - Demo Deck Cadet 06', status: 'reupload_requested', admin_remarks: 'Please upload a clear & complete copy.' },
      { document_name: 'INDOS - Demo Deck Cadet 06', status: 'accepted', admin_remarks: 'Accepted document remark' },
      { document_name: 'STCW - Demo Deck Cadet 06', status: 'pending', admin_remarks: 'Pending document remark' },
      { document_name: 'CDC - Demo Deck Cadet 06', status: 'rejected', admin_remarks: 'Rejected document remark' },
      { document_name: 'PASSPORT - Demo Deck Cadet 06', status: 'reupload_requested', admin_remarks: null },
    ],
  });

  assert.equal(subject, 'Action Required: Document Re-upload - MOLMI');
  assert.match(html, /Dear TechGuru Institute/);
  assert.match(html, /for cadet <strong>Demo Deck Cadet 06<\/strong>/);
  assert.match(html, /CV - Demo Deck Cadet 06/);
  assert.match(html, /PASSPORT - Demo Deck Cadet 06/);
  assert.match(html, /Please upload a clear &amp; complete copy\./);
  assert.match(html, /<td>-<\/td>/);
  assert.doesNotMatch(html, /INDOS|STCW|CDC|Accepted document remark|Pending document remark|Rejected document remark/);
  assert.doesNotMatch(html, /reupload_requested|>Status</);
  assert.equal((html.match(/<tr>/g) || []).length, 2);
  assert.match(html, /href="https:\/\/example.com\/upload\?cadet=06&amp;drive=demo"/);
  assert.match(html, /upload only the documents listed above/);
});

test('ordinary status emails keep the reviewed documents and omit re-upload instructions', () => {
  const { subject, html } = emailTemplates.documentStatusReport({
    recipientName: 'TechGuru Institute',
    cadetName: 'Demo Deck Cadet 06',
    requiresReupload: false,
    documents: [
      { document_name: 'CV', status: 'accepted', admin_remarks: 'Verified' },
      { document_name: 'INDOS', status: 'rejected', admin_remarks: 'Invalid document' },
    ],
  });

  assert.equal(subject, 'Document Status Update - MOLMI');
  assert.match(html, /<th align="left">Status<\/th>/);
  assert.match(html, /<td>CV<\/td>/);
  assert.match(html, /<td>accepted<\/td>/);
  assert.match(html, /Verified/);
  assert.match(html, /<td>INDOS<\/td>/);
  assert.match(html, /<td>rejected<\/td>/);
  assert.doesNotMatch(html, /re-upload|Open OneDrive Folder|href=/);
});

// Simple generator for review URLs to debug review.html
const REVIEW_BASE = 'https://shahcaf.github.io/Craftly-Staff-apply/review.html';

const samplePayload = {
  discord_tag: 'testuser#1234',
  discord_id: '123456789012345678',
  age: '20',
  timezone: 'GMT+1',
  hours_active: '10',
  role: 'discord_staff',
  why_staff: 'I want to help the community and moderate fairly.'
};

const jsonStr = JSON.stringify(samplePayload);
// Do not pre-encode the JSON; let URLSearchParams handle encoding.
const answersParam = jsonStr;

const build = (action) => {
  const url = new URL(REVIEW_BASE);
  url.searchParams.set('action', action);
  url.searchParams.set('tag', samplePayload.discord_tag);
  url.searchParams.set('answers', answersParam);
  return url.toString();
};

console.log('Approve URL:');
console.log(build('approve'));
console.log('\nReject URL:');
console.log(build('reject'));

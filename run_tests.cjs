import {exec} from 'child_process';
exec('node --test --test-concurrency=1 tests/node_technical_document.cjs', (error, stdout, stderr) => {
  if (error) {
    console.error('Exec error:', error);
    return;
  }
  if (stderr) {
    console.error('Test stderr:', stderr);
    return;
  }
  console.log('Test stdout:', stdout);
});
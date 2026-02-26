const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'node_modules', '@types', 'mapbox__point-geometry');

if (fs.existsSync(dir)) {
    console.log('Removing problematic @types/mapbox__point-geometry directory...');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('Successfully removed.');
} else {
    console.log('@types/mapbox__point-geometry not found.');
}

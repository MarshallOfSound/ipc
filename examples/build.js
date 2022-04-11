const { generateWiring } = require('../');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const examples = fs.readdirSync(__dirname).filter(example => fs.statSync(path.resolve(__dirname, example)).isDirectory());

const fatal = (err) => {
    console.error(err);
    process.exit(1);
}

for (const example of examples) {
    const exampleDir = path.resolve(__dirname, example);

    generateWiring({
        schemaFolder: exampleDir,
        wiringFolder: exampleDir + '/app/ipc',
    }).then(() => {
        // Write a tsconfig we can use
        const tsconfig = path.resolve(exampleDir, 'tsconfig.json');
        fs.writeFileSync(tsconfig, `{
            "compilerOptions": {
              "module": "commonjs",
              "target": "es2017",
              "lib": [
                "es2017",
                "dom"
              ],
              "sourceMap": true,
              "strict": true,
              "outDir": "dist",
              "types": [
                "node"
              ],
              "allowSyntheticDefaultImports": true,
              "moduleResolution": "node",
              "declaration": true,
              "incremental": true
            },
            "include": [
              "app"
            ]
          }
          `);
        console.log('Building application')
        cp.spawnSync('yarn', ['tsc', '-p', tsconfig], {
            cwd: exampleDir,
            stdio: 'inherit'
        });
    }).catch((err) => fatal(err));
}

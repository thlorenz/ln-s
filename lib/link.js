// Possible Enhancements: 
//  - allow just passing bar and figure out that it is in ./node_modules

'use strict';

var resolvePaths =  require('./resolve-paths')
  , log          =  require('npmlog')
  , path         =  require('path')
  , fs           =  require('fs')
  , rmrf         =  require('rimraf')
  , ncp          =  require('ncp')
  , cp           =  require('child_process')
  , exec         =  cp.exec
  ;

function relSymlink (from, to) {
  var relLink = path.relative(path.resolve(from, '..'), to);
  fs.symlinkSync(relLink, from);
}

/**
 * Links a node_module to another implementation in a directory outside the directory tree of the current package.
 *
 * Comments based on foo and bar being sibling dirs and foo having installed bar as inside ./foo/node_modules:
 *
 *  ./foo
 *    /node_modules
 *      /bar
 *        /node_modules
 *  ./bar
 *    /node_modules
 *
 * The following links are created:
 *
 *  - ./foo/node_modules/bar -> ./bar 
 *  - ./bar/node_modules -> ./foo/node_modules/bar/node_modules
 *
 *
 * The pseudo package ./node_modules are a copy of the original ./bar/node_modules.
 * 
 * Additionally it creates links for all packages no longer found inside ./foo/node_modules/bar/node_modules due to
 * running npm dedupe back up to ./foo/node_modules. This is necessary since due to dirs being linked, the automatic
 * lookup mechanism upwards (NODE_PATHS) is broken since it doesn't look from where we link to, but from where we
 * link from.
 * Therefore we need to provide it manually.
 *  
 * @name exports
 * @function
 * @param opts {Object} with the following properties
 *  - root: defaults to cwd, the directory of the main package whose dependency we want to link -- i.e. ./foo
 *  - src:  path to the dependent to link to an outside directory -- i.e. ./foo/node_modules/bar
 *  - tgt:  path to the directory to link the dependent to -- i.e. ./bar
 *  - nodedupe: if set the npm dedupe step is skipped
 *  - loglevel: silly | verbose | info | warn | error
 */
var go = module.exports = function (opts) {
  log.level = opts.loglevel || 'info';

  var p = resolvePaths(opts);
  
  // Create pseudo package (bar--__--)
  try {
    rmrf.sync(p.pseudo);
    fs.mkdirSync(p.pseudo);
  } catch (e) {
    console.error(e);
  }

  // Move ../bar/node_modules to ./node_modules/bar--__--/node_modules
  ncp(p.tgtNodeModules, p.pseudoNodeModules, function (err) {
    rmrf.sync(p.tgtNodeModules);    

    // Link ./bar/node_modules -> ./foo/node_modules/bar--__--/node_modules
    relSymlink(p.tgtNodeModules, p.pseudoNodeModules); 
    
    // Copy ../bar/package.json to ./node_modules/bar--__--/package.json and set name to 'bar--__--'
    var pkg = require(p.tgtPackage);
    pkg.name = p.pseudoName;
    fs.writeFileSync(p.pseudoPackage, JSON.stringify(pkg, null, 2), 'utf8');

    // Remove ./node_modules/bar
    rmrf.sync(p.src);

    // Link ./node_modules/bar -> ../bar
    relSymlink(p.src, p.tgt);
    
    // Run npm dedupe unless --nodedupe is set
    var dedupe = exec('npm dedupe', { cwd: p.root }, function (err) {
      if (err) return console.error(err);

      log.info('deli', 'Deduped main package');

      // link deduped packages
      Object.keys(pkg.dependencies)
        .forEach(function (k) {
          var inLocal = path.join(p.pseudoNodeModules, k)
            , inMain = path.join(p.mainNodeModules, k);

          if (fs.existsSync(inLocal)) return;

          // Link ./foo/node_modules/bar--__--/node_modules/common -> ./foo/node_modules/common
          log.verbose('deli', 'Module "%s" was deduped, linking to main node_modules', k);
          if (fs.existsSync(inMain)) return relSymlink(inLocal, inMain);

          log.warn('deli', 'Unable to find "%s" in main node_modules, not linking', k);
        })
      
      console.log(require('../test/fixtures/initial-a/')());

    })
    dedupe.stdout.pipe(process.stdout);
    dedupe.stderr.pipe(process.stderr);
  });
};

// Test
if (!module.parent) {

  var fixtures = path.join(__dirname, '..', 'test', 'fixtures');
  var from = path.join(fixtures, 'initial');
  var to = path.join(fixtures, 'initial-a');

  rmrf.sync(to);
  ncp(from, to, function (err) {
    if (err) return console.error(err);

    var root = path.join(fixtures, 'initial-a', 'foo');

    var opts = {
        root: root
      , src: path.join('node_modules', 'bar')
      , tgt: path.join('..', 'bar')
      , loglevel: 'silly'
    }

    go(opts);
    
  });
}
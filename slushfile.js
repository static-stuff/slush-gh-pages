'use strict';

const gulp = require('gulp');
const path = require('path');
const fs = require('fs');
const async = require('async');
const install = require('gulp-install');
const conflict = require('gulp-conflict');
const template = require('gulp-template');
const rename = require('gulp-rename');
const jeditor = require('gulp-json-editor');
const clone = require('lodash.clone');
const merge = require('lodash.merge');
const slugify = require('uslug');
const inquirer = require('inquirer');
const iniparser = require('iniparser');
const moment = require('moment-timezone');

const pkg = require('./package.json');

const TEMPLATE_SETTINGS = {
  evaluate: /\{SLUSH\{(.+?)\}\}/g,
  interpolate: /\{SLUSH\{=(.+?)\}\}/g,
  escape: /\{SLUSH\{-(.+?)\}\}/g
};

const format = function (string) {
  if (string) {
    return string.toLowerCase().replace(/\s/g, '');
  }
  return '';
};

const dest = function (filepath) {
  return path.resolve(process.cwd(), filepath || './');
};

const defaults = (function () {
  const homeDir = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
  const workingDirName = process.cwd().split('/').pop().split('\\').pop();
  const workingDirNoExt = workingDirName.replace(/\.[a-z]{2,3}$/, '');

  let osUserName;
  if (homeDir && homeDir.split('/').pop()) {
    osUserName = homeDir.split('/').pop();
  } else {
    osUserName = 'root';
  }

  const configFile = `${homeDir}/.gitconfig`;

  let user = {};

  if (require('fs').existsSync(configFile)) {
    user = iniparser.parseSync(configFile).user || {};
  }

  return {
    name: workingDirName,
    slug: slugify(workingDirNoExt),
    userName: format(user.name) || osUserName,
    authorEmail: user.email || '',
    timezone: moment.tz.guess()
  };
})();

const parseGithubRepo = function (str) {
  const githubRe = /(?:https?:\/\/github.com)?\/?([^\/.]+\/[^\/]+)(?:\.git)?$/i;
  const match = str.match(githubRe);

  if (match && match[1]) {
    return match[1].replace(/\.git$/, '');
  }

  return null;
};

gulp.task('default', done => {
  const prompts = [{
    name: 'name',
    message: 'What is the PRETTY name of your site?',
    default: defaults.name
  }, {
    name: 'slug',
    message: 'What is the name SLUG for your site?',
    default: defaults.slug,
    validate(slug) {
      return slug === slugify(slug);
    }
  }, {
    name: 'url',
    message: 'What is the url for your site?',
    default(answers) {
      return `http://www.${answers.slug}.com`;
    }
  }, {
    name: 'hostname',
    message: 'What is the hostname for your site? [Leave blank if not using a custom domain]',
    default() {
      return false;
    }
  }, {
    name: 'author',
    message: 'Who is authoring the site?',
    default() {
      let author = defaults.userName;
      if (defaults.authorEmail) {
        author += ` <${defaults.authorEmail}>`;
      }
      return author;
    }
  }, {
    name: 'description',
    message: 'Please describe your site.'
  }, {
    name: 'keywords',
    message: 'Please enter some site keywords.'
  }, {
    name: 'timezone',
    message: 'What is the timezone for your site?',
    default: defaults.timezone
  }, {
    name: 'version',
    message: 'What is the version of your site?',
    default: '0.1.0'
  }, {
    name: 'permalink',
    message: 'Which permalink pattern would you like to use?',
    type: 'list',
    choices: [{
      name: 'Date',
      message: '/:categories/:year/:month/:day/:title.html',
      value: 'date'
    }, {
      name: 'Pretty',
      message: '/:categories/:year/:month/:day/:title/',
      value: 'pretty'
    }, {
      name: 'Ordinal',
      message: '/:categories/:year/:y_day/:title.html',
      value: 'ordinal'
    }, {
      name: 'None',
      message: '/:categories/:title.html',
      value: 'none'
    }]
  }, {
    name: 'github',
    message: 'GitHub repo name? (e.g. foo/bar, https://github.com/foo/bar.git) This is required!',
    validate(str) {
      if (str === null) {
        return false;
      }
      return true;
    },
    filter(str) {
      return parseGithubRepo(str);
    }
  }, {
    name: 'githubToken',
    message: `GitHub token? (Required for some plugins. Suggest permissions are 'public_repo' and 'gist')
See: https://help.github.com/articles/creating-an-oauth-token-for-command-line-use`
  }, {
    type: 'confirm',
    name: 'moveon',
    message: 'Continue?'
  }];

  // Ask
  inquirer.prompt(prompts).then(answers => {
    if (!answers.moveon) {
      return done();
    }

    const config = clone(answers);

    config.generatorVersion = pkg.version;
    config.year = moment.tz(new Date(), answers.timezone).format('YYYY');

    const authorEmail = answers.author.match(/(<(.+)>)/);
    config.authorName = authorEmail ? answers.author.replace(authorEmail[1], '') : answers.author;
    config.authorEmail = authorEmail ? authorEmail[2] : '';

    const githubParts = answers.github.match(/([^\/].+)\/(.+)/);
    config.githubAuthorName = githubParts ? githubParts[1] : '';
    config.githubAuthorUrl = `https://github.com/${config.githubAuthorName}`;
    config.githubRepoName = githubParts ? githubParts[2] : '';
    config.githubRepoUrl = `https://github.com/${answers.github}`;

    const binaryFileExtensions = 'png|ico|gif|jpg|jpeg|svg|psd|bmp|webp|webm';

    const srcDir = path.join(__dirname, 'templates');
    const destDir = dest();

    const installTextFiles = function (cb) {
      const src = [
        `**/*.!(${binaryFileExtensions})`,
        '!CNAME',
        '!_gitignore',
        '!.DS_Store',
        '!**/.DS_Store',
        '!package.json'
      ];

      gulp.src(src, {dot: true, cwd: srcDir, base: srcDir})
        .pipe(template(config, TEMPLATE_SETTINGS))
        .pipe(conflict(destDir, {logger: console.log}))
        .pipe(gulp.dest(destDir))
        .on('end', cb);
    };

    const installBinaryFiles = function (cb) {
      const src = [
        `**/*.+(${binaryFileExtensions})`,
        '!CNAME',
        '!_gitignore',
        '!.DS_Store',
        '!**/.DS_Store',
        '!package.json'
      ];

      gulp.src(src, {dot: true, cwd: srcDir, base: srcDir})
        .pipe(conflict(destDir, {logger: console.log}))
        .pipe(gulp.dest(destDir))
        .on('end', cb);
    };

    const installGitignore = function (cb) {
      gulp.src('_gitignore', {cwd: srcDir, base: srcDir})
        .pipe(rename('.gitignore'))
        .pipe(conflict(destDir, {logger: console.log}))
        .pipe(gulp.dest(destDir))
        .on('end', cb);
    };

    const installCNAME = function (cb) {
      if (!answers.hostname) {
        return cb();
      }

      gulp.src('CNAME', {cwd: srcDir, base: srcDir})
        .pipe(template(config, TEMPLATE_SETTINGS))
        .pipe(conflict(destDir, {logger: console.log}))
        .pipe(gulp.dest(destDir))
        .on('end', cb);
    };

    const mergePackageAndInstall = function (cb) {
      const pkgMerge = function (pkg) {
        if (fs.existsSync(dest('package.json'))) {
          const existingPkg = require(dest('package.json'));
          return merge(existingPkg, pkg);
        }
        return pkg;
      };

      gulp.src('package.json', {cwd: srcDir, base: srcDir})
        .pipe(template(config, TEMPLATE_SETTINGS))
        .pipe(jeditor(pkgMerge, {
          'indent_char': ' ',
          'indent_size': 2
        }))
        .pipe(gulp.dest(destDir))
        .pipe(install())
        .on('end', cb);
    };
    const tasks = [
      installTextFiles,
      installBinaryFiles,
      installCNAME,
      installGitignore,
      mergePackageAndInstall
    ];
    async.series(tasks, done);
  });
});

'use strict';

const path = require('path');
const url = require('url');
const gulp = require('gulp');
const moment = require('moment-timezone');
const inquirer = require('inquirer');
const chalk = require('chalk');
const argv = require('minimist')(process.argv.slice(2));
const clone = require('lodash/clone');
const trimEnd = require('lodash/trimEnd');
const validateGithubRepo = require('./utils/validate-github-repo');
const parseGithubRepo = require('./utils/parse-github-repo');
const getDefaults = require('./utils/get-defaults');
const slugify = require('./utils/slugify');
const getThemes = require('./utils/get-themes');
const getBootswatchThemes = require('./utils/get-bootswatch-themes');
const getOlsonTZNames = require('./utils/get-olson-tz-names');
const installTheme = require('./tasks/install-theme');
const pkg = require('./package.json');

const THEMES_DIR = path.join(__dirname, 'themes');
const THEMES_TMP_DIR = path.join(process.cwd(), '.theme-tmp');

const defaults = getDefaults();

if (!defaults.repoPresent) {
  console.log(`
---
${chalk.bgRed.bold('No git repo is present. You should clone or init one first!')}
${chalk.bold('(ctrl-c to terminate this set up)')}
---
`);
}

gulp.task('default', done => {
  const prompts = [{
    name: 'github',
    default() {
      if (defaults.config && defaults.config.repository) {
        return defaults.config.repository;
      }
      if (defaults.gitConfig && defaults.gitConfig['remote "origin"']) {
        return defaults.gitConfig['remote "origin"'].url;
      }
    },
    validate(str) {
      if (str === null) {
        return false;
      }
      return true;
    },
    filter(str) {
      return validateGithubRepo(str);
    },
    message: `GitHub repo name? This is required. [e.g., foo/bar, https://github.com/foo/bar.git]
>`
  }, {
    name: 'branch',
    default(answers) {
      if (defaults.branch) {
        return defaults.branch;
      }
      const repo = parseGithubRepo(answers.github);
      if (repo.githubRepoName === `${repo.githubAuthorName}.github.io`) {
        return 'master';
      }
      return 'gh-pages';
    },
    message: `Branch for GitHub Pages? [required for Travis testing set-up]
>`
  }, {
    name: 'githubToken',
    default: defaults.githubToken,
    message: `GitHub token? [Permissions required are 'public_repo' and 'gist'. See: https://git.io/v61m7]
--It is strongly advised that you provide this. Some plugins may fail without it.--
>`
  }, {
    name: 'name',
    default(answers) {
      if (defaults.name) {
        return defaults.name;
      }
      return parseGithubRepo(answers.github).githubRepoName;
    },
    validate(str) {
      if (!str) {
        return false;
      }
      return true;
    },
    message() {
      return `What is the name of your site?
>`;
    }
  }, {
    name: 'url',
    default(answers) {
      if (defaults.url) {
        return defaults.url;
      }

      if (defaults.hostname) {
        return `http://${defaults.hostname}`;
      }

      const repo = parseGithubRepo(answers.github);
      return `https://${repo.githubAuthorName}.github.io`;
    },
    validate(str) {
      if (str === null) {
        return false;
      }
      return true;
    },
    filter(str) {
      const parsed = url.parse(str);
      if (!parsed.hostname) {
        return null;
      }
      return `${parsed.protocol}//${parsed.hostname}`;
    },
    message: `What is the url for your site?
>`
  }, {
    name: 'baseurl',
    default(answers) {
      if (defaults.config && defaults.config.baseurl) {
        return defaults.config.baseurl;
      }

      const repo = parseGithubRepo(answers.github);
      const parsed = url.parse(answers.url);
      if (parsed.hostname === `${repo.githubAuthorName}.github.io` &&
          parsed.hostname !== repo.githubRepoName) {
        return `/${repo.githubRepoName}`;
      }

      return '';
    },
    filter(str) {
      return trimEnd(str, '/');
    },
    message: `What is the site's baseurl?
[e.g., '/blog', '/docs' or nothing at all]
>`
  }, {
    name: 'author',
    default: defaults.authorName,
    message: `Who is authoring the site? [name only]
>`
  }, {
    name: 'email',
    default: defaults.authorEmail,
    message: `Author's email address?
>`
  }, {
    name: 'twitter',
    default: defaults.authorTwitter,
    message: `Author's Twitter username? [for jekyll-seo plugin]
>`
  }, {
    name: 'description',
    default: defaults.description,
    message: `Please describe your site.
>`
  }, {
    name: 'timezone',
    default: defaults.config && defaults.config.timezone ? defaults.config.timezone : defaults.timezone,
    type: 'list',
    choices: getOlsonTZNames(),
    message: `What is the timezone for your site?
>`
  }, {
    name: 'version',
    default: defaults.pkg ? defaults.pkg.version : '0.1.0',
    message: `What is the version of your site?
>`
  }, {
    name: 'permalink',
    default: defaults.config && defaults.config.permalink,
    message: `Which permalink pattern would you like to use? [see: https://git.io/v6hJD]
>`,
    type: 'list',
    choices: [{
      name: 'Date (/:categories/:year/:month/:day/:title.html)',
      value: 'date'
    }, {
      name: 'Pretty (/:categories/:year/:month/:day/:title/)',
      value: 'pretty'
    }, {
      name: 'Ordinal (/:categories/:year/:y_day/:title.html)',
      value: 'ordinal'
    }, {
      name: 'None (/:categories/:title.html)',
      value: 'none'
    }]
  }, {
    name: 'theme',
    message: 'Which theme would you like to use?',
    type: 'list',
    default: 'default',
    choices() {
      return getThemes();
    }
  }, {
    name: 'bootswatch',
    message: 'Which Bootswatch theme would you like?',
    type: 'list',
    when: answers => answers.theme === 'bootswatch',
    choices() {
      const choices = [{
        name: '- None -',
        value: 'none'
      }, new inquirer.Separator()];

      return getBootswatchThemes().then(themes => choices.concat(themes));
    }
  }, {
    type: 'confirm',
    name: 'moveon',
    message: 'Continue?'
  }];

  // Ask
  inquirer.prompt(prompts).then(answersRaw => {
    let answers = clone(answersRaw);
    if (!answers.moveon) {
      return done();
    }

    // Add GitHub repo info
    answers = Object.assign(answers, parseGithubRepo(answers.github));

    // Add version of this generator
    answers.generatorVersion = pkg.version;

    // Basic time info in selected timezone
    answers.now = moment.tz(new Date(), answers.timezone).format('YYYY-MM-DD HH:mm:ss Z');
    answers.year = moment.tz(new Date(), answers.timezone).format('YYYY');

    // Slugify the name
    answers.slug = slugify(answers.name);

    // Using a CNAME
    const parsed = url.parse(answers.url);
    if (parsed.hostname.search(/\.github\.(io|com)$/) === -1) {
      answers.hostname = parsed.hostname;
    }

    installTheme({
      answers,
      defaults,
      themesDir: THEMES_DIR,
      themesTmpDir: THEMES_TMP_DIR,
      skipInstall: argv['skip-install']
    })
    .then(() => {
      done();
      process.exit();
    })
    .catch(err => {
      done(err);
      process.exit();
    });
  });
});

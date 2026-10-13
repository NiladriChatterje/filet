# Contributing to Filet

Thanks for your interest in improving Filet. Bug reports, feature ideas and pull requests are all welcome.

## Reporting a bug

Open an issue on GitHub and include:

* The command you ran and the full terminal output.
* Your operating system and Node.js version (`node --version`).
* The browser used on the receiving side, if the problem is on that end.
* Whether the status on the receiver page turned green (direct) or yellow (relay).

Please do not post share links or share codes in public issues. They are the only secret protecting a share.

## Proposing a change

1. Fork the repository and create a branch from `main`.
2. Run `npm install` in the repository root.
3. Make your change. Keep the three parts of the project separate: the CLI (`index.js`, `lib/`), the signaling Worker (`signaling/`) and the receiver page (`docs/`).
4. Run `npm test` and check that `npm audit --omit=dev` reports no new findings.
5. Test a real transfer: run `node index.js <file>`, open the printed link in a browser and download the file.
6. Open a pull request with a short description of what changed and why.

## Style

* ES modules, two-space indentation, no build step.
* Keep dependencies to a minimum. Every new dependency should be justified in the pull request.
* The receiver page is plain HTML, CSS and JavaScript with no framework.

## Security issues

If you find a vulnerability, please do not open a public issue. Email the maintainer through the address on the npm package page instead and allow a reasonable time for a fix before disclosure.

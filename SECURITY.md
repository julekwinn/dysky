# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue:

- through GitHub's [private vulnerability reporting](https://github.com/julekwinn/dysky/security/advisories/new) (Security tab → Report a vulnerability), or
- by email to **contact@youlius.com**.

Say what you found, the Dysky and Windows versions, and how to reproduce it. Dysky is made by one person, so expect a first reply within a week. Fixes go out as a new release, and you are credited in the changelog unless you'd rather not be.

Only the latest release gets security fixes.

## Scope

Dysky reads file system metadata only: names, sizes and attributes. It never opens file contents, never writes, moves or deletes anything, and makes no network requests. The window's Content Security Policy allows connections only to Tauri's `ipc:` channel.

So these are in scope, for example:

- any way to make Dysky change, delete or create files, or run a program other than File Explorer
- a file or folder name that injects script or markup into the window
- a path that makes "Show in File Explorer" open or run something else
- anything that makes the app or the WebView reach the network

Out of scope: the SmartScreen warning for the unsigned installer, and attacks that already need admin rights or full control of your user account.

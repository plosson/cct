
# Notes features

Add a tab type called "Notes". It should be a markdown editor, and save the content in .claudiu/notes.md

# move back to command hooks 

We are currently using an HTTP hooks for claude code, but when (for whatever reason) the hooks are not uninstalled, 
you see hook errors in Claude Code. Let's move to command hook, write a script called emit.sh, and call that script in the hook definition.
Our script will then properly swallow the errors. 

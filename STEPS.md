## Steps

### Step 33 - Configuration screen 

We should have a global configuration screen for :
  - command line to use for claude code session (by default) 
  - command line to use for terminal session (by default)

All configuration can be overriden at project level 

Meaning we should find a nice way to reuse the same screen in essence when configuring a project 
with the global default show in grey or something, a way to set or unset a project specific value. 

Make the configuration code properly architected so that the config is type but generic as well and can be extended 
to more configuration settings in the feature. 

### Step 34 - Command line invocation 

I would like user to be able to do : 

```bash
cct .
``` 
or
```bash
cct $HOME/devel/project/my-project
```

to open the project in CTT. The flow is as follows : 

1/ is CTT already open. If so, reuse the same process, if not open CTT
2/ does the project already exists, if so, just select the project, if not, create the project. 

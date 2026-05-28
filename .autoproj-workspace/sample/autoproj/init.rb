Autoproj.isolate_environment
Autoproj.config.set("build", File.join(Autoproj.root_dir, "build"))
Autoproj.config.set("source", "src")
Autoproj.config.separate_prefixes = true
Autobuild::CMake.delete_obsolete_files_in_prefix = Autoproj.config.separate_prefixes?

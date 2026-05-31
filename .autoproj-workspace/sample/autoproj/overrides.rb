Autoproj.workspace.manifest.each_autobuild_package do |pkg|
    next unless pkg.kind_of?(Autobuild::CMake)

    pkg.define 'CMAKE_EXPORT_COMPILE_COMMANDS', true
end
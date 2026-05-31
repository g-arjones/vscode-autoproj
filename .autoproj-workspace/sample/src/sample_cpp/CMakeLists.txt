cmake_minimum_required(VERSION 3.8)
project(sample_cpp)

add_executable(sample_cpp src/main.cpp)
target_include_directories(sample_cpp PUBLIC "${CMAKE_INSTALL_PREFIX}/../sample_lib/include")
target_link_directories(sample_cpp PUBLIC "${CMAKE_INSTALL_PREFIX}/../sample_lib/lib")
target_link_libraries(sample_cpp PUBLIC sample_lib)
install(TARGETS sample_cpp RUNTIME DESTINATION bin)

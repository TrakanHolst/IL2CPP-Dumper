#include "../include/utils.hxx"
#include <iostream>
#include <direct.h>
#include <algorithm>
#include <chrono>
#include <iomanip>
#include <sstream>

std::ofstream logFile;
static auto startTime = std::chrono::steady_clock::now();


void Log( const std::string & msg ) {
    // Calculate elapsed time since start
    auto now = std::chrono::steady_clock::now();
    auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - startTime);

    // Format: [MM:SS.mmm] message
    int totalMs = elapsed.count();
    int minutes = totalMs / 60000;
    int seconds = (totalMs % 60000) / 1000;
    int ms = totalMs % 1000;

    std::ostringstream timestamped;
    timestamped << "["
                << std::setfill('0') << std::setw(2) << minutes << ":"
                << std::setfill('0') << std::setw(2) << seconds << "."
                << std::setfill('0') << std::setw(3) << ms << "] "
                << msg;

    std::string finalMsg = timestamped.str();
    std::cout << finalMsg << "\n";
    logFile << finalMsg << "\n";
    logFile.flush( );
}


void EnsureDirectory( const std::string & path ) {
    // Create all parent directories recursively
    std::string current;
    for ( size_t i = 0; i < path.length( ); i++ ) {
        if ( path[ i ] == '\\' || path[ i ] == '/' ) {
            if ( !current.empty( ) && current.back( ) != ':' ) {
                _mkdir( current.c_str( ) );
            }
        }
        current += path[ i ];
    }
    // Create the final directory
    if ( !current.empty( ) ) {
        _mkdir( current.c_str( ) );
    }
}


std::string GetAccessModifier( uint32_t flags ) {
    uint32_t access = flags & 0x0007;

    switch ( access ) {
        case 0x0006: return "public";
        case 0x0001: return "private";
        case 0x0004: return "protected";
        case 0x0005: return "protected internal";
        default:     return "private";
    }
}


std::string GetModuleDirectory( ) {
    char buffer[ MAX_PATH ];
    GetModuleFileNameA( NULL, buffer, MAX_PATH );
    std::string path( buffer );
    size_t pos = path.find_last_of( "\\/" );
    if ( pos != std::string::npos ) {
        return path.substr( 0, pos );
    }
    return ".";
}

std::string GetDllDirectory( void* hModule ) {
    char buffer[ MAX_PATH ];
    GetModuleFileNameA( ( HMODULE ) hModule, buffer, MAX_PATH );
    std::string path( buffer );
    size_t pos = path.find_last_of( "\\/" );
    if ( pos != std::string::npos ) {
        return path.substr( 0, pos );
    }
    return ".";
}
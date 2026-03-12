#define _CRT_SECURE_NO_WARNINGS

#include <windows.h>
#include <iostream>
#include "../include/utils.hxx"
#include "../include/dumper.hxx"
#include "../include/runtime_dumper.hxx"


FILE * Startup( HMODULE hModule ) {
    AllocConsole( );

    FILE * fDummy = nullptr;
    freopen_s( &fDummy, "CONOUT$", "w", stdout );
    freopen_s( &fDummy, "CONIN$", "r", stdin );

    SetConsoleTitleA( "IL2CPP Dumper - INSERT=ClassDump | DELETE=RuntimeData" );

    // Initialize log file in DLL directory
    std::string logPath = GetDllDirectory( hModule ) + "\\IL2CPPDump_Log.txt";
    logFile.open( logPath );

    Log( "Log file: " + logPath );

    return fDummy;
}


DWORD WINAPI EntryPoint( LPVOID lpParam ) {
    HMODULE hModule = ( HMODULE ) lpParam;
    FILE * output = Startup( hModule );

    Log( "DLL injected." );
    Log( "Press INSERT = Dump IL2CPP classes" );
    Log( "Press DELETE = Dump runtime game data" );

    bool classDumpDone = false;
    bool runtimeDumpDone = false;

    while ( !classDumpDone || !runtimeDumpDone ) {
        // INSERT key - Class structure dump
        if ( !classDumpDone && ( GetAsyncKeyState( VK_INSERT ) & 0x8000 ) ) {
            Log( "\n[INSERT] Starting class structure dump..." );
            Sleep( 300 );

            Dumper dumper;

            if ( dumper.images.empty( ) ) {
                Log( "[ERROR] No images/assemblies found" );
            } else {
                Log( "[OK] Found " + std::to_string( dumper.images.size( ) ) + " assemblies" );
                dumper.DumpAllToFiles( );
            }

            classDumpDone = true;
            Log( "[OK] Class dump complete!" );
        }

        // DELETE key - Runtime data dump
        if ( !runtimeDumpDone && ( GetAsyncKeyState( VK_DELETE ) & 0x8000 ) ) {
            Log( "\n[DELETE] Starting runtime data dump..." );
            Sleep( 300 );

            RuntimeDumper rtDumper;
            rtDumper.DumpAllGameData( );

            runtimeDumpDone = true;
            Log( "[OK] Runtime data dump complete!" );
        }

        Sleep( 50 );
    }

    Log( "\nAll dumps finished. Press Enter to exit..." );
    std::cin.get( );

    if ( output ) fclose( output );
    FreeConsole( );

    FreeLibraryAndExitThread( hModule, 0 );
    return 0;
}


BOOL APIENTRY DllMain( HMODULE hModule, DWORD reason, LPVOID lpReserved ) {
    switch ( reason ) {
        case DLL_PROCESS_ATTACH:
            DisableThreadLibraryCalls( hModule );
            CreateThread( nullptr, 0, EntryPoint, hModule, 0, nullptr );
            break;
    }

    return TRUE;
}
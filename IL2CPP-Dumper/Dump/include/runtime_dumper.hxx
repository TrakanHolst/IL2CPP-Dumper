#ifndef RUNTIME_DUMPER_H
#define RUNTIME_DUMPER_H

#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <algorithm>
#include <cctype>
#include <string>
#include <vector>
#include <unordered_set>
#include "rapidjson/document.h"
#include "rapidjson/writer.h"
#include "rapidjson/filewritestream.h"
#include "rapidjson/prettywriter.h"
#include "rapidjson/stringbuffer.h"
#include "utils.hxx"

// Keep nlohmann for backward compatibility during transition
#include <nlohmann/json.hpp>

// Need IL2CPP API for inline streaming functions
#include "il2cpp_api.hxx"

using json = nlohmann::json;
using namespace rapidjson;

class RuntimeDumper {

public:
    RuntimeDumper( );

    // Find and dump all game config tables
    void DumpAllGameData( );

private:
    // Dynamic serialization system
    json SerializeObjectDynamic( void* obj, int depth = 0 );
    json SerializeFieldValue( void* obj, void* field, void* fieldType, int depth );
    json SerializeDictionary( void* dictObj, int depth );
    json SerializeList( void* listObj, int depth );
    bool IsPrimitiveType( const std::string& typeName );
    bool IsUnityType( const std::string& typeName );
    std::string GetEnumName( void* enumClass, int32_t enumValue );

    // Serialize any IL2CPP object to JSON
    json SerializeObject( void* obj, void* klass );

    // Serialize specific Unity types
    json SerializeVector3( void* obj );
    json SerializeQuaternion( void* obj );
    json SerializeColor( void* obj );

    // Find static field value
    void* GetStaticFieldValue( void* klass, const char* fieldName );

    // Find singleton instances
    void* FindSingleton( const char* className, const char* namespaceName );

    // Scan all static fields to find an instance
    void* ScanForStaticInstance( const char* className, const char* namespaceName );

    // Serialize MissionAreaTable
    json SerializeMissionAreaTable( void* missionAreaTableObj );

    // Dump specific config tables
    void DumpGameplayConfigMissionAreaTable( );
    void DumpGameplayConfigWorldEntityRegistry( );
    void DumpConfigTable( const char* className, const char* namespaceName, const char* filename );
    void DumpDataManagerTable( void* dataManager, const char* fieldName, const char* outputFilename );

    // Streaming JSON write for large tables (writes incrementally to avoid memory issues)
    void DumpDataManagerTableStreaming( void* dataManager, const char* fieldName, const char* outputFilename );

    // Dump dictionary entries as individual files
    void DumpDictionaryAsFiles( void* dataManager, const char* fieldName, const char* folderName );

    // Helper: Write nlohmann::json using RapidJSON's efficient Writer
    bool WriteJsonWithRapidJSON( const json& data, const std::string& filepath );

    // STREAMING serialization - writes directly to RapidJSON Writer (NO memory buildup)
    template<typename Writer>
    bool StreamSerializeFieldValue( Writer& writer, void* obj, void* field, void* fieldType, int depth );

    template<typename Writer>
    bool StreamSerializeObject( Writer& writer, void* obj, int depth );

    template<typename Writer>
    bool StreamSerializeList( Writer& writer, void* listObj, int depth );

    template<typename Writer>
    bool StreamSerializeDictionary( Writer& writer, void* dictObj, int depth );

    // Dump all level data (per-level extraction)
    void DumpAllLevelData( void* dataManager );

    // Helper: Split entities by category and write sub-files
    void SplitAndWriteLevelFiles( const std::string& levelId, const std::string& folder, const json& fullData );
};

// Inline template implementations - must be in header for visibility
// These write JSON directly to disk with ZERO memory buildup

// Forward declare visited set
extern thread_local std::unordered_set<void*> g_visitedObjects;

template<typename Writer>
inline bool RuntimeDumper::StreamSerializeFieldValue( Writer& writer, void* obj, void* field, void* fieldType, int depth ) {
    if ( depth > 12 ) {
        writer.Null();
        return true;
    }
    void* fieldValue = api::field_get_value_object( field, obj );
    if ( !fieldValue ) {
        writer.Null();
        return true;
    }
    return StreamSerializeObject( writer, fieldValue, depth + 1 );
}

template<typename Writer>
inline bool RuntimeDumper::StreamSerializeObject( Writer& writer, void* obj, int depth ) {
    if ( !obj ) {
        writer.Null();
        return true;
    }

    if ( depth > 12 ) {
        writer.String( "[depth_limit]" );
        return true;
    }

    if ( depth > 2 ) {
        if ( g_visitedObjects.find( obj ) != g_visitedObjects.end() ) {
            writer.String( "[circular_ref]" );
            return true;
        }
        g_visitedObjects.insert( obj );
    }

    void* klass = api::object_get_class( obj );
    if ( !klass ) {
        writer.Null();
        return true;
    }

    const char* className = api::class_get_name( klass );
    const char* namespaceName = api::class_get_namespace( klass );
    if ( !className || !namespaceName ) {
        writer.Null();
        return true;
    }

    std::string fullName = std::string( namespaceName ) + "." + className;
    if ( fullName.find( "System.Action" ) != std::string::npos ||
         fullName.find( "System.Func" ) != std::string::npos ||
         fullName.find( "System.Delegate" ) != std::string::npos ||
         fullName.find( "UnityEvent" ) != std::string::npos ||
         fullName.find( "Callback" ) != std::string::npos ) {
        writer.String( "[skipped_runtime_type]" );
        return true;
    }

    // FIRST: Check if this IS a primitive type itself (Int32, Boolean, etc.)
    // These have m_value as their internal field, not as a wrapper
    std::string classType = className ? className : "";
    if ( classType == "Int32" ) {
        int32_t val = *( int32_t* ) ( ( uintptr_t ) obj + 0x10 );
        writer.Int( val );
        return true;
    } else if ( classType == "Boolean" ) {
        bool val = *( bool* ) ( ( uintptr_t ) obj + 0x10 );
        writer.Bool( val );
        return true;
    } else if ( classType == "Single" || classType == "Float" ) {
        float val = *( float* ) ( ( uintptr_t ) obj + 0x10 );
        writer.Double( val );
        return true;
    } else if ( classType == "Double" ) {
        double val = *( double* ) ( ( uintptr_t ) obj + 0x10 );
        writer.Double( val );
        return true;
    } else if ( classType == "Int64" || classType == "UInt64" ) {
        int64_t val = *( int64_t* ) ( ( uintptr_t ) obj + 0x10 );
        writer.Int64( val );
        return true;
    } else if ( classType == "UInt32" ) {
        uint32_t val = *( uint32_t* ) ( ( uintptr_t ) obj + 0x10 );
        writer.Uint( val );
        return true;
    } else if ( classType == "Byte" ) {
        uint8_t val = *( uint8_t* ) ( ( uintptr_t ) obj + 0x10 );
        writer.Uint( val );
        return true;
    }

    // SECOND: Handle wrapper objects - if object ONLY has m_value field, unwrap it
    // OPTIMIZATION: Only check wrappers at depth 0-1 (wrappers are rare in deep nesting)
    void* mValueField = api::class_get_field_from_name( klass, "m_value" );
    if ( mValueField && depth <= 1 ) {
        // Count non-static fields
        int fieldCount = 0;
        void* iter = nullptr;
        while ( void* field = api::class_get_fields( klass, &iter ) ) {
            uint32_t flags = api::field_get_flags( field );
            if ( flags & 0x0010 ) continue; // Skip static
            fieldCount++;
            if ( fieldCount > 1 ) break;
        }

        // If only field is m_value, it's a wrapper - extract primitive value directly
        if ( fieldCount == 1 ) {
            void* fieldValue = api::field_get_value_object( mValueField, obj );
            if ( !fieldValue ) {
                writer.Null();
                return true;
            }

            void* valueClass = api::object_get_class( fieldValue );
            if ( valueClass ) {
                const char* valueClassName = api::class_get_name( valueClass );
                std::string valueType = valueClassName ? valueClassName : "";

                // Extract primitive values directly to avoid infinite recursion
                if ( valueType == "Int32" ) {
                    int32_t val = *( int32_t* ) ( ( uintptr_t ) fieldValue + 0x10 );
                    writer.Int( val );
                    return true;
                } else if ( valueType == "Boolean" ) {
                    bool val = *( bool* ) ( ( uintptr_t ) fieldValue + 0x10 );
                    writer.Bool( val );
                    return true;
                } else if ( valueType == "Single" || valueType == "Float" ) {
                    float val = *( float* ) ( ( uintptr_t ) fieldValue + 0x10 );
                    writer.Double( val );
                    return true;
                } else if ( valueType == "Double" ) {
                    double val = *( double* ) ( ( uintptr_t ) fieldValue + 0x10 );
                    writer.Double( val );
                    return true;
                }
            }

            // Not a primitive, recurse normally (but increment depth to prevent infinite loop)
            return StreamSerializeObject( writer, fieldValue, depth + 1 );
        }
    }

    // Defensive String handling with bounds check
    if ( fullName == "System.String" ) {
        __try {
            uint32_t length = *( uint32_t* ) ( ( uintptr_t ) obj + 0x10 );
            if ( length > 0 && length < 100000 ) {
                wchar_t* chars = ( wchar_t* ) ( ( uintptr_t ) obj + 0x14 );
                if ( chars ) {
                    std::wstring wstr( chars, length );
                    std::string str( wstr.begin(), wstr.end() );
                    writer.String( str.c_str() );
                    return true;
                }
            }
        } __except( EXCEPTION_EXECUTE_HANDLER ) {
            writer.String( "[invalid_string]" );
            return true;
        }
        writer.String( "" );
        return true;
    }

    if ( fullName.find( "Dictionary" ) != std::string::npos ) {
        return StreamSerializeDictionary( writer, obj, depth + 1 );
    }

    if ( fullName.find( "List" ) != std::string::npos ) {
        return StreamSerializeList( writer, obj, depth + 1 );
    }

    // Handle arrays - check if className ends with []
    std::string classNameStr = className;
    if ( classNameStr.find( "[]" ) != std::string::npos ) {
        __try {
            if ( depth >= 8 ) {
                writer.StartArray();
                writer.EndArray();
                return true;
            }
            // IL2CPP arrays have length at offset 0x18
            int32_t arrayLength = *( int32_t* ) ( ( uintptr_t ) obj + 0x18 );

            if ( arrayLength < 0 || arrayLength > 100000 ) {
                writer.StartArray();
                writer.EndArray();
                return true;
            }

            if ( arrayLength > 200 ) {
                arrayLength = 200;
            }

            writer.StartArray();

            // Get element class to determine if value type or reference type
            void* elementClass = api::class_get_element_class( klass );
            bool isValueType = elementClass && api::class_is_valuetype( elementClass );

            if ( isValueType ) {
                // Value types (primitives/structs) - stored inline
                const char* elemClassName = api::class_get_name( elementClass );
                std::string elemTypeStr = elemClassName ? elemClassName : "";

                if ( elemTypeStr == "Int32" ) {
                    int32_t* elements = ( int32_t* ) ( ( uintptr_t ) obj + 0x20 );
                    for ( int32_t i = 0; i < arrayLength; ++i ) {
                        if ( i > 0 && i % 10 == 0 ) Sleep( 200 ); // GC pause
                        writer.Int( elements[i] );
                    }
                } else if ( elemTypeStr == "UInt32" ) {
                    uint32_t* elements = ( uint32_t* ) ( ( uintptr_t ) obj + 0x20 );
                    for ( int32_t i = 0; i < arrayLength; ++i ) {
                        if ( i > 0 && i % 10 == 0 ) Sleep( 200 );
                        writer.Uint( elements[i] );
                    }
                } else if ( elemTypeStr == "Int64" ) {
                    int64_t* elements = ( int64_t* ) ( ( uintptr_t ) obj + 0x20 );
                    for ( int32_t i = 0; i < arrayLength; ++i ) {
                        if ( i > 0 && i % 10 == 0 ) Sleep( 200 );
                        writer.Int64( elements[i] );
                    }
                } else if ( elemTypeStr == "Single" || elemTypeStr == "Float" ) {
                    float* elements = ( float* ) ( ( uintptr_t ) obj + 0x20 );
                    for ( int32_t i = 0; i < arrayLength; ++i ) {
                        if ( i > 0 && i % 10 == 0 ) Sleep( 200 );
                        writer.Double( elements[i] );
                    }
                } else if ( elemTypeStr == "Boolean" ) {
                    bool* elements = ( bool* ) ( ( uintptr_t ) obj + 0x20 );
                    for ( int32_t i = 0; i < arrayLength; ++i ) {
                        if ( i > 0 && i % 10 == 0 ) Sleep( 200 );
                        writer.Bool( elements[i] );
                    }
                } else {
                    // Complex value type (struct) - read fields directly from memory
                    int32_t elementSize = api::class_get_instance_size( elementClass );
                    if ( elementSize > 0 && elementSize < 1000 ) {
                        uintptr_t elementsStart = ( uintptr_t ) obj + 0x20;
                        for ( int32_t i = 0; i < arrayLength; ++i ) {
                            if ( i > 0 && i % 10 == 0 ) Sleep( 200 );

                            __try {
                                uintptr_t elementAddr = elementsStart + ( i * elementSize );
                                writer.StartObject();

                                void* iter = nullptr;
                                while ( void* field = api::class_get_fields( elementClass, &iter ) ) {
                                    uint32_t flags = api::field_get_flags( field );
                                    if ( flags & 0x0010 ) continue;

                                    const char* fieldName = api::field_get_name( field );
                                    if ( !fieldName ) continue;

                                    void* fieldType = api::field_get_type( field );
                                    if ( !fieldType ) continue;

                                    const char* typeName = api::type_get_name( fieldType );
                                    std::string typeStr = typeName ? typeName : "";

                                    int32_t fieldOffset = api::field_get_offset( field );
                                    uintptr_t fieldAddr = elementAddr + fieldOffset;

                                    writer.Key( fieldName );

                                    // Read primitive types directly from memory
                                    __try {
                                        if ( typeStr == "System.Int32" ) {
                                            writer.Int( *( int32_t* ) fieldAddr );
                                        } else if ( typeStr == "System.UInt32" ) {
                                            writer.Uint( *( uint32_t* ) fieldAddr );
                                        } else if ( typeStr == "System.Int64" ) {
                                            writer.Int64( *( int64_t* ) fieldAddr );
                                        } else if ( typeStr == "System.UInt64" ) {
                                            writer.Uint64( *( uint64_t* ) fieldAddr );
                                        } else if ( typeStr == "System.Single" ) {
                                            writer.Double( *( float* ) fieldAddr );
                                        } else if ( typeStr == "System.Double" ) {
                                            writer.Double( *( double* ) fieldAddr );
                                        } else if ( typeStr == "System.Boolean" ) {
                                            writer.Bool( *( bool* ) fieldAddr );
                                        } else {
                                            // Unknown type, write null
                                            writer.Null();
                                        }
                                    } __except( EXCEPTION_EXECUTE_HANDLER ) {
                                        writer.Null();
                                    }
                                }
                                writer.EndObject();
                            } __except( EXCEPTION_EXECUTE_HANDLER ) {
                                // If whole element fails, write error object
                                writer.StartObject();
                                writer.Key( "error" );
                                writer.String( "struct_read_failed" );
                                writer.EndObject();
                            }
                        }
                    }
                }
            } else {
                // Reference types - elements are pointers (8 bytes each)
                for ( int32_t i = 0; i < arrayLength; ++i ) {
                    if ( i > 0 && i % 10 == 0 ) Sleep( 200 );
                    void* item = *( void** ) ( ( uintptr_t ) obj + 0x20 + ( i * 8 ) );
                    if ( item ) {
                        StreamSerializeObject( writer, item, depth + 1 );
                    } else {
                        writer.Null();
                    }
                }
            }

            writer.EndArray();
            return true;
        } __except( EXCEPTION_EXECUTE_HANDLER ) {
            writer.String( "[array_error]" );
            return true;
        }
    }

    // Handle enums - they have value__ field, extract the enum name
    void* valueField = api::class_get_field_from_name( klass, "value__" );
    if ( valueField ) {
        // This is an enum, get the name instead of integer
        __try {
            int32_t enumValue = *( int32_t* ) ( ( uintptr_t ) obj + api::field_get_offset( valueField ) );
            std::string enumName = GetEnumName( klass, enumValue );
            writer.String( enumName.c_str() );
            return true;
        } __except( EXCEPTION_EXECUTE_HANDLER ) {
            writer.Null();
            return true;
        }
    }

    writer.StartObject();
    void* currentClass = klass;
    int fieldCounter = 0;
    while ( currentClass ) {
        void* iter = nullptr;
        while ( void* field = api::class_get_fields( currentClass, &iter ) ) {
            uint32_t flags = api::field_get_flags( field );
            if ( flags & 0x0010 ) continue;

            const char* fieldName = api::field_get_name( field );
            if ( !fieldName ) continue;

            std::string fieldNameStr( fieldName );
            if ( fieldNameStr.find( "__BackingField" ) != std::string::npos ) {
                size_t start = fieldNameStr.find( '<' ) + 1;
                size_t end = fieldNameStr.find( '>' );
                if ( start != std::string::npos && end != std::string::npos ) {
                    fieldNameStr = fieldNameStr.substr( start, end - start );
                }
            }

            std::string loweredFieldName = fieldNameStr;
            std::transform( loweredFieldName.begin(), loweredFieldName.end(), loweredFieldName.begin(), ::tolower );
            if ( loweredFieldName.find( "callback" ) != std::string::npos ||
                 loweredFieldName.find( "delegate" ) != std::string::npos ||
                 loweredFieldName.find( "actionmap" ) != std::string::npos ||
                 loweredFieldName.find( "variabledict" ) != std::string::npos ||
                 loweredFieldName.find( "blackboard" ) != std::string::npos ||
                 fieldNameStr == "condition" ||
                 fieldNameStr == "conditions" ||
                 fieldNameStr == "onResultChange" ||
                 fieldNameStr == "onResultChangeCallback" ||
                 fieldNameStr == "m_refTarget" ||
                 fieldNameStr == "m_target" ||
                 fieldNameStr == "m_runningActionExecutorList" ) {
                continue;
            }

            // FIELD-LEVEL FILTERING: Skip heavy fields in Interactive objects
            // Keep all POI classification data needed by map generator
            if ( fullName.find( "Interactive" ) != std::string::npos ) {
                // Whitelist of essential fields to keep for map POI generation
                static const char* interactiveWhitelist[] = {
                    "levelLogicId",          // Unique ID - USED by map generator
                    "entityType",            // Type (e.g., "Interactive") - USED by map generator
                    "entityDataIdKey",       // What it is (e.g., "int_campfire_v2") - USED by map generator for categorization
                    "createState",           // State (e.g., "EnableAndShow")
                    "position",              // {x, y, z} coordinates - USED by map generator
                    "rotation",              // Rotation data - USED by map generator
                    "scale",                 // Scale data
                    "isLocked"               // Lock status - USED by map generator
                    // "isClientOnly"        - Not used by map generator
                    // "hideInDialog"        - Not used by map generator
                    // "modelScale"          - Not used by map generator
                    // "progressLockCondition" - Not used by map generator
                    // "properties"          - NOT USED by map generator! Removed to save space
                    // "globalProperties"    - NOT USED by map generator! Removed to save space
                    // "componentProperties" - NOT USED by map generator! Creates 594MB files - REMOVED
                    // "globalIntKeyList"    - Not used by map generator
                };

                // Check if field is in whitelist
                bool isWhitelisted = false;
                for ( const char* allowed : interactiveWhitelist ) {
                    if ( fieldNameStr == allowed ) {
                        isWhitelisted = true;
                        break;
                    }
                }

                // Skip fields not in whitelist (now only skipping truly unnecessary fields)
                if ( !isWhitelisted ) {
                    continue;
                }
            }

            // FIELD-LEVEL FILTERING: Skip heavy fields in Enemy objects
            // Enemy objects have complex nested data we don't need (bornBehaviorData, aiBlackboard, etc.)
            if ( fullName.find( "Enemy" ) != std::string::npos ) {
                // Whitelist of essential fields to keep for map enemy spawns
                static const char* enemyWhitelist[] = {
                    "levelLogicId",      // Unique ID
                    "entityType",        // Type (e.g., "Enemy")
                    "entityDataIdKey",   // What enemy it is (e.g., "eny_0057_dog")
                    "createState",       // State (e.g., "EnableAndShow", "Disable")
                    "position",          // {x, y, z} coordinates - ESSENTIAL for map
                    "level",             // Enemy level/difficulty
                    "respawnable"        // Whether enemy respawns
                };

                // Check if field is in whitelist
                bool isWhitelisted = false;
                for ( const char* allowed : enemyWhitelist ) {
                    if ( fieldNameStr == allowed ) {
                        isWhitelisted = true;
                        break;
                    }
                }

                // Skip fields not in whitelist (rotation, scale, bornBehaviorData, aiBlackboard, overrideAIConfig, etc.)
                if ( !isWhitelisted ) {
                    continue;
                }
            }

            // FIELD-LEVEL FILTERING: Skip heavy fields in FactoryRegion objects
            // FactoryRegion objects have complex nested arrays we don't need (buildableRange, mines, initialBuildings, etc.)
            if ( fullName.find( "FactoryRegion" ) != std::string::npos ) {
                // Whitelist of essential fields to keep for factory POI locations
                static const char* factoryRegionWhitelist[] = {
                    "levelLogicId",      // Unique ID
                    "entityType",        // Type (e.g., "FactoryRegion")
                    "entityDataIdKey",   // What it is (e.g., "factory_region")
                    "createState",       // State (e.g., "EnableAndShow")
                    "position",          // {x, y, z} coordinates - ESSENTIAL for map
                    "regionId"           // Factory region identifier
                };

                // Check if field is in whitelist
                bool isWhitelisted = false;
                for ( const char* allowed : factoryRegionWhitelist ) {
                    if ( fieldNameStr == allowed ) {
                        isWhitelisted = true;
                        break;
                    }
                }

                // Skip fields not in whitelist (rotation, scale, buildableRange, mines, initialBuildings, areas, etc.)
                if ( !isWhitelisted ) {
                    continue;
                }
            }

            // FIELD-LEVEL FILTERING: Skip heavy fields in NPC objects
            // NPC objects have similar structure to Interactives - keep essential POI data
            if ( fullName.find( "Npc" ) != std::string::npos && fullName.find( "NpcCluster" ) == std::string::npos ) {
                // Whitelist of essential fields to keep for NPC POIs
                static const char* npcWhitelist[] = {
                    "levelLogicId",          // Unique ID
                    "entityType",            // Type (e.g., "Npc")
                    "entityDataIdKey",       // What NPC it is
                    "createState",           // State (e.g., "EnableAndShow", "Disable")
                    "position",              // {x, y, z} coordinates - ESSENTIAL for map
                    "rotation",              // Rotation data
                    "scale",                 // Scale data
                    "isLocked"               // Lock status (if exists)
                    // "properties"          - NOT USED by map generator! Removed to save space
                    // "globalProperties"    - NOT USED by map generator! Removed to save space
                    // "componentProperties" - NOT USED by map generator! Removed to save space
                };

                // Check if field is in whitelist
                bool isWhitelisted = false;
                for ( const char* allowed : npcWhitelist ) {
                    if ( fieldNameStr == allowed ) {
                        isWhitelisted = true;
                        break;
                    }
                }

                // Skip fields not in whitelist
                if ( !isWhitelisted ) {
                    continue;
                }
            }

            void* fieldType = api::field_get_type( field );
            if ( !fieldType ) continue;

            // SKIP m_value fields entirely - they're Unity IL2CPP wrappers handled by unwrapping logic above
            if ( fieldNameStr == "m_value" ) {
                continue;
            }

            // Pause every 10 fields to let GC run (prevents "collecting from unknown thread")
            fieldCounter++;
            if ( fieldCounter % 10 == 0 ) {
                Sleep( 200 ); // 200ms BIG pause for GC (consistent with all other pauses)
            }

            writer.Key( fieldNameStr.c_str() );
            StreamSerializeFieldValue( writer, obj, field, fieldType, depth );
        }
        currentClass = api::class_get_parent( currentClass );
        if ( currentClass ) {
            const char* parentName = api::class_get_name( currentClass );
            if ( parentName && std::string( parentName ) == "Object" ) break;
        }
    }
    writer.EndObject();
    return true;
}

template<typename Writer>
inline bool RuntimeDumper::StreamSerializeList( Writer& writer, void* listObj, int depth ) {
    if ( !listObj ) {
        writer.StartArray();
        writer.EndArray();
        return true;
    }

    void* listClass = api::object_get_class( listObj );
    if ( !listClass ) {
        writer.StartArray();
        writer.EndArray();
        return true;
    }

    void* sizeField = api::class_get_field_from_name( listClass, "_size" );
    if ( !sizeField ) {
        writer.StartArray();
        writer.EndArray();
        return true;
    }

    int32_t offset = api::field_get_offset( sizeField );
    int32_t size = *( int32_t* ) ( ( uintptr_t ) listObj + offset );

    // Only reject obviously corrupted sizes (negative or absurdly large)
    if ( size < 0 || size > 100000000 ) {
        writer.StartArray();
        writer.EndArray();
        return true;
    }

    void* itemsField = api::class_get_field_from_name( listClass, "_items" );
    if ( !itemsField ) {
        writer.StartArray();
        writer.EndArray();
        return true;
    }

    offset = api::field_get_offset( itemsField );
    void* itemsArray = *( void** ) ( ( uintptr_t ) listObj + offset );
    if ( !itemsArray ) {
        writer.StartArray();
        writer.EndArray();
        return true;
    }

    writer.StartArray();
    void* arrayClass = api::object_get_class( itemsArray );
    void* elementClass = arrayClass ? api::class_get_element_class( arrayClass ) : nullptr;
    bool isValueType = elementClass && api::class_is_valuetype( elementClass );

    if ( isValueType ) {
        // Value types (structs/primitives) - stored inline
        const char* elemClassName = api::class_get_name( elementClass );
        std::string elemTypeStr = elemClassName ? elemClassName : "";

        // NO SIZE LIMIT - process all elements
        __try {
            if ( elemTypeStr == "UInt64" || elemTypeStr == "Int64" ) {
                uintptr_t elementsStart = ( uintptr_t ) itemsArray + 0x20;
                for ( int32_t i = 0; i < size; ++i ) {
                    if ( i > 0 && i % 10 == 0 ) Sleep( 200 ); // BIG GC pause (reduce if works)
                    int64_t value = *( int64_t* ) ( elementsStart + ( i * 8 ) );
                    writer.StartObject();
                    writer.Key( "valueBit64" );
                    writer.Int64( value );
                    writer.EndObject();
                }
            } else if ( elemTypeStr == "Int32" ) {
                uintptr_t elementsStart = ( uintptr_t ) itemsArray + 0x20;
                for ( int32_t i = 0; i < size; ++i ) {
                    if ( i > 0 && i % 10 == 0 ) Sleep( 200 ); // BIG GC pause (reduce if works)
                    int32_t value = *( int32_t* ) ( elementsStart + ( i * 4 ) );
                    writer.StartObject();
                    writer.Key( "valueBit64" );
                    writer.Int( value );
                    writer.EndObject();
                }
            } else {
                // Complex structs - read fields directly from memory
                const char* elemClassName = api::class_get_name( elementClass );
                Log( std::string( "Processing value type array: " ) + ( elemClassName ? elemClassName : "unknown" ) );

                // Calculate element size by summing field sizes
                int32_t elementSize = 0;
                __try {
                    void* iter = nullptr;
                    while ( void* field = api::class_get_fields( elementClass, &iter ) ) {
                        uint32_t flags = api::field_get_flags( field );
                        if ( flags & 0x0010 ) continue; // Skip static fields

                        void* fieldType = api::field_get_type( field );
                        if ( !fieldType ) continue;

                        const char* typeName = api::type_get_name( fieldType );
                        std::string typeStr = typeName ? typeName : "";

                        // Add size based on type
                        if ( typeStr == "System.Int32" || typeStr == "System.UInt32" || typeStr == "System.Single" ) {
                            elementSize += 4;
                        } else if ( typeStr == "System.Int64" || typeStr == "System.UInt64" || typeStr == "System.Double" ) {
                            elementSize += 8;
                        } else if ( typeStr == "System.Boolean" || typeStr == "System.Byte" ) {
                            elementSize += 1;
                        } else if ( typeStr == "System.Int16" || typeStr == "System.UInt16" ) {
                            elementSize += 2;
                        } else {
                            Log( "    Unknown field type: " + typeStr + ", assuming 4 bytes" );
                            elementSize += 4;
                        }
                    }
                } __except( EXCEPTION_EXECUTE_HANDLER ) {
                    Log( "Exception calculating element size, using fallback" );
                    elementSize = 0;
                }

                Log( "Calculated element size: " + std::to_string( elementSize ) + " bytes, Array size: " + std::to_string( size ) + " elements" );

                if ( elementSize > 0 && elementSize < 1000 ) {
                    uintptr_t elementsStart = ( uintptr_t ) itemsArray + 0x20;
                    Log( "Elements start address: 0x" + std::to_string( elementsStart ) );

                    for ( int32_t i = 0; i < size; ++i ) {
                        if ( i > 0 && i % 10 == 0 ) Sleep( 200 ); // BIG GC pause (reduce if works)

                        __try {
                            uintptr_t elementAddr = elementsStart + ( i * elementSize );
                            if ( i < 3 ) Log( "Processing element " + std::to_string( i ) + " at 0x" + std::to_string( elementAddr ) );

                            writer.StartObject();

                            // Read fields sequentially without offset calculation
                            uintptr_t currentAddr = elementAddr;
                            void* iter = nullptr;
                            int fieldCount = 0;
                            while ( void* field = api::class_get_fields( elementClass, &iter ) ) {
                                uint32_t flags = api::field_get_flags( field );
                                if ( flags & 0x0010 ) continue;

                                const char* fieldName = api::field_get_name( field );
                                if ( !fieldName ) continue;

                                void* fieldType = api::field_get_type( field );
                                if ( !fieldType ) continue;

                                const char* typeName = api::type_get_name( fieldType );
                                std::string typeStr = typeName ? typeName : "";

                                // Normalize field name: strip "m_" prefix and lowercase (for Unity types)
                                std::string normalizedFieldName = fieldName;
                                if ( normalizedFieldName.length() > 2 && normalizedFieldName[0] == 'm' && normalizedFieldName[1] == '_' ) {
                                    normalizedFieldName = normalizedFieldName.substr( 2 ); // Remove "m_"
                                    if ( !normalizedFieldName.empty() ) {
                                        normalizedFieldName[0] = std::tolower( normalizedFieldName[0] ); // Lowercase first char
                                    }
                                }

                                if ( i < 3 && fieldCount == 0 ) {
                                    Log( "  First field: " + std::string( fieldName ) + " -> " + normalizedFieldName + " (type: " + typeStr + ")" );
                                }

                                writer.Key( normalizedFieldName.c_str() );

                                // Read primitive types sequentially from current address
                                __try {
                                    if ( typeStr == "System.Int32" ) {
                                        int32_t val = *( int32_t* ) currentAddr;
                                        if ( i < 3 && fieldCount == 0 ) Log( "    Value: " + std::to_string( val ) );
                                        writer.Int( val );
                                        currentAddr += 4;
                                    } else if ( typeStr == "System.UInt32" ) {
                                        writer.Uint( *( uint32_t* ) currentAddr );
                                        currentAddr += 4;
                                    } else if ( typeStr == "System.Int64" ) {
                                        int64_t val = *( int64_t* ) currentAddr;
                                        if ( i < 3 && fieldCount == 0 ) Log( "    Value: " + std::to_string( val ) );
                                        writer.Int64( val );
                                        currentAddr += 8;
                                    } else if ( typeStr == "System.UInt64" ) {
                                        uint64_t val = *( uint64_t* ) currentAddr;
                                        if ( i < 3 && fieldCount == 0 ) Log( "    Value: " + std::to_string( val ) );
                                        writer.Uint64( val );
                                        currentAddr += 8;
                                    } else if ( typeStr == "System.Single" ) {
                                        writer.Double( *( float* ) currentAddr );
                                        currentAddr += 4;
                                    } else if ( typeStr == "System.Double" ) {
                                        writer.Double( *( double* ) currentAddr );
                                        currentAddr += 8;
                                    } else if ( typeStr == "System.Boolean" ) {
                                        writer.Bool( *( bool* ) currentAddr );
                                        currentAddr += 1;
                                    } else {
                                        // Unknown type, write null
                                        if ( i < 3 && fieldCount == 0 ) Log( "    UNKNOWN TYPE, writing null" );
                                        writer.Null();
                                    }
                                } __except( EXCEPTION_EXECUTE_HANDLER ) {
                                    Log( "EXCEPTION reading field " + std::string( fieldName ) + " at element " + std::to_string( i ) );
                                    writer.Null();
                                }
                                fieldCount++;
                            }
                            writer.EndObject();
                        } __except( EXCEPTION_EXECUTE_HANDLER ) {
                            // If whole element fails, write error object
                            Log( "EXCEPTION processing entire element " + std::to_string( i ) );
                            writer.StartObject();
                            writer.Key( "error" );
                            writer.String( "struct_read_failed" );
                            writer.EndObject();
                        }
                    }
                    Log( "Finished processing " + std::to_string( size ) + " elements" );
                } else {
                    Log( "Skipping: invalid element size" );
                }
            }
        } __except( EXCEPTION_EXECUTE_HANDLER ) {
            // If crash during value type processing, write error marker
            Log( "CRITICAL: Outer exception caught during value type array processing!" );
            writer.String( "[value_type_error]" );
        }
    } else {
        // Reference types - elements are pointers
        // NO SIZE LIMIT - process all elements
        __try {
            for ( int32_t i = 0; i < size; ++i ) {
                if ( i > 0 && i % 10 == 0 ) Sleep( 200 ); // BIG GC pause (reduce if works)
                void* item = *( void** ) ( ( uintptr_t ) itemsArray + 0x20 + ( i * 8 ) );
                if ( item ) {
                    StreamSerializeObject( writer, item, depth + 1 );
                } else {
                    writer.Null();
                }
            }
        } __except( EXCEPTION_EXECUTE_HANDLER ) {
            writer.String( "[ref_type_error]" );
        }
    }
    writer.EndArray();
    return true;
}

template<typename Writer>
inline bool RuntimeDumper::StreamSerializeDictionary( Writer& writer, void* dictObj, int depth ) {
    if ( !dictObj ) {
        writer.StartObject();
        writer.EndObject();
        return true;
    }

    void* dictClass = api::object_get_class( dictObj );
    if ( !dictClass ) {
        writer.StartObject();
        writer.EndObject();
        return true;
    }

    // Get count
    void* countField = api::class_get_field_from_name( dictClass, "_count" );
    if ( !countField ) {
        writer.StartObject();
        writer.EndObject();
        return true;
    }

    int32_t offset = api::field_get_offset( countField );
    int32_t count = *( int32_t* ) ( ( uintptr_t ) dictObj + offset );

    if ( count <= 0 || count > 100000 ) {
        writer.StartObject();
        writer.EndObject();
        return true;
    }

    // Get entries array
    void* entriesField = api::class_get_field_from_name( dictClass, "_entries" );
    if ( !entriesField ) {
        writer.StartObject();
        writer.EndObject();
        return true;
    }

    offset = api::field_get_offset( entriesField );
    void* entriesArray = *( void** ) ( ( uintptr_t ) dictObj + offset );
    if ( !entriesArray ) {
        writer.StartObject();
        writer.EndObject();
        return true;
    }

    writer.StartObject();

    __try {
        for ( int32_t i = 0; i < count; ++i ) {
            if ( i > 0 && i % 10 == 0 ) Sleep( 200 ); // BIG GC pause

            uintptr_t entryAddr = ( uintptr_t ) entriesArray + 0x20 + ( i * 24 );

            // Get key
            std::string keyStr;
            uintptr_t keyAsPtr = *( uintptr_t* ) ( entryAddr + 8 );
            bool isPointer = ( keyAsPtr > 0x10000 && keyAsPtr < 0x7FFFFFFFFFFF );

            if ( isPointer ) {
                void* keyPtr = ( void* ) keyAsPtr;
                void* keyClass = api::object_get_class( keyPtr );
                if ( keyClass ) {
                    const char* keyClassName = api::class_get_name( keyClass );
                    if ( keyClassName && std::string( keyClassName ) == "String" ) {
                        uint32_t length = *( uint32_t* ) ( ( uintptr_t ) keyPtr + 0x10 );
                        if ( length > 0 && length < 10000 ) {
                            wchar_t* chars = ( wchar_t* ) ( ( uintptr_t ) keyPtr + 0x14 );
                            if ( chars ) {
                                std::wstring wstr( chars, length );
                                keyStr = std::string( wstr.begin(), wstr.end() );
                            }
                        }
                    } else if ( keyClassName && std::string( keyClassName ) == "Int32" ) {
                        int32_t keyInt = *( int32_t* ) ( ( uintptr_t ) keyPtr + 0x10 );
                        keyStr = std::to_string( keyInt );
                    }
                }
            } else {
                // Key is primitive (integer)
                keyStr = std::to_string( keyAsPtr );
            }

            if ( keyStr.empty() ) continue;

            // Get value
            void* valuePtr = *( void** ) ( entryAddr + 16 );

            writer.Key( keyStr.c_str() );

            // Wrap value serialization in try-catch to prevent malformed JSON
            __try {
                if ( valuePtr ) {
                    StreamSerializeObject( writer, valuePtr, depth + 1 );
                } else {
                    writer.Null();
                }
            } __except( EXCEPTION_EXECUTE_HANDLER ) {
                // If value serialization crashes, write null to complete the key-value pair
                writer.Null();
            }
        }
    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        // Continue with partial dictionary
    }

    writer.EndObject();
    return true;
}

#endif // RUNTIME_DUMPER_H

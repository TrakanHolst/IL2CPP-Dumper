#include "../include/runtime_dumper.hxx"
#include "../include/il2cpp_api.hxx"
#include "../include/il2cpp_class.hxx"
#include "../include/utils.hxx"
#include <fstream>
#include <unordered_set>
#include <map>

static std::string SafeDumpJSON( const json& j, bool& success );

namespace {
constexpr int kMaxDynamicDepth = 12;
constexpr int kMaxCollectionDepth = 8;
constexpr int kMaxCollectionItems = 200;
constexpr int kMaxTopLevelCollectionItems = 20000;

bool ShouldShortCircuitType( const std::string& fullName ) {
    static const char* tokens[] = {
        "System.Action",
        "System.Func",
        "System.Delegate",
        "UnityEvent",
        "Callback",
        "EventHandler",
        "AIBlackboard"
    };

    for ( const char* token : tokens ) {
        if ( fullName.find( token ) != std::string::npos ) {
            return true;
        }
    }
    return false;
}

bool ShouldSkipRuntimeField( const std::string& ownerType, const std::string& fieldName ) {
    std::string lowered = fieldName;
    std::transform( lowered.begin(), lowered.end(), lowered.begin(), ::tolower );

    static const char* genericTokens[] = {
        "callback", "delegate", "event", "actionmap", "variabledict",
        "runningaction", "blackboard", "listener", "executor", "tracker"
    };
    for ( const char* token : genericTokens ) {
        if ( lowered.find( token ) != std::string::npos ) {
            return true;
        }
    }

    if ( ownerType.find( "MissionRuntimeAsset" ) != std::string::npos ) {
        return fieldName == "condition" ||
               fieldName == "conditions" ||
               fieldName == "onResultChange" ||
               fieldName == "onResultChangeCallback" ||
               fieldName == "m_refTarget" ||
               fieldName == "m_target" ||
               fieldName == "m_runningActionExecutorList" ||
               fieldName == "actionMap" ||
               fieldName == "variableDict";
    }

    if ( ownerType.find( "InteractiveTemplateData" ) != std::string::npos ) {
        static const char* allowed[] = {
            "configProperties",
            "componentList",
            "templateVariant",
            "bornTag",
            "factionIndex"
        };
        for ( const char* field : allowed ) {
            if ( fieldName == field ) return false;
        }
        return true;
    }

    if ( ownerType.find( "InteractiveTemplateVariant" ) != std::string::npos ) {
        static const char* allowed[] = {
            "diffProperties",
            "componentDiffProperties",
            "globalVarDiff",
            "mapVarDiff"
        };
        for ( const char* field : allowed ) {
            if ( fieldName == field ) return false;
        }
        return true;
    }

    if ( ownerType.find( "ParamKeyValue" ) != std::string::npos ) {
        return !( fieldName == "key" || fieldName == "value" );
    }

    if ( ownerType.find( "PropertyStateData" ) != std::string::npos ) {
        return fieldName != "optionName";
    }

    if ( ownerType.find( "ComponentData" ) != std::string::npos ||
         ownerType.find( "ControllerData" ) != std::string::npos ) {
        static const char* allowed[] = {
            "modelId",
            "modelScale",
            "propertyStateData",
            "propertyList"
        };
        for ( const char* field : allowed ) {
            if ( fieldName == field ) return false;
        }
        return true;
    }

    return false;
}
}

RuntimeDumper::RuntimeDumper( ) {
    // Initialize IL2CPP API if not already done
    api::init( );
    Sleep( 500 );  // Give it a moment to settle
}

// Category code to filename mapping (based on digits 5-6 of levelLogicId)
static std::string GetFilenameForCategory( const std::string& categoryCode ) {
    static std::map<std::string, std::string> categoryMap = {
        {"01", "01"}, {"02", "02"}, {"03", "factory"}, {"04", "gm01m1"}, {"05", "e1m1"},
        {"06", "e1m2"}, {"07", "sm1l1m1"}, {"11", "gm01m7"}, {"12", "gm01m8"}, {"13", "e1m3"},
        {"18", "sm1l1m2"}, {"19", "04"}, {"21", "gm01m2"}, {"23", "sm1l1m5"}, {"24", "sm1l1m6"},
        {"28", "sm1l1m9"}, {"32", "05"}, {"33", "env"}, {"39", "06"}, {"42", "07"},
        {"43", "08"}, {"45", "m1m10"}, {"46", "world_energypoint"}, {"48", "c17m2"},
        {"62", "snapshot_activity_v0d8"}, {"64", "m1m19"}
    };

    auto it = categoryMap.find( categoryCode );
    if ( it != categoryMap.end( ) ) {
        return it->second;
    }
    return ""; // Unknown category
}

// Extract category code from levelLogicId (digits 5-6 of 10-digit ID)
static std::string GetCategoryFromLogicId( int64_t levelLogicId ) {
    std::string idStr = std::to_string( levelLogicId );
    if ( idStr.length( ) >= 6 ) {
        return idStr.substr( 4, 2 ); // Extract digits 5-6 (0-indexed: positions 4-5)
    }
    return "";
}

// Check if a type is primitive
bool RuntimeDumper::IsPrimitiveType( const std::string& typeName ) {
    return typeName.find( "Int32" ) != std::string::npos ||
           typeName.find( "UInt32" ) != std::string::npos ||
           typeName.find( "Int64" ) != std::string::npos ||
           typeName.find( "UInt64" ) != std::string::npos ||
           typeName.find( "Single" ) != std::string::npos ||
           typeName.find( "Double" ) != std::string::npos ||
           typeName.find( "Boolean" ) != std::string::npos ||
           typeName.find( "String" ) != std::string::npos ||
           typeName.find( "Byte" ) != std::string::npos ||
           typeName.find( "SByte" ) != std::string::npos ||
           typeName.find( "Int16" ) != std::string::npos ||
           typeName.find( "UInt16" ) != std::string::npos;
}

// Check if a type is a Unity type
bool RuntimeDumper::IsUnityType( const std::string& typeName ) {
    return typeName.find( "UnityEngine.Vector3" ) != std::string::npos ||
           typeName.find( "UnityEngine.Vector2" ) != std::string::npos ||
           typeName.find( "UnityEngine.Quaternion" ) != std::string::npos ||
           typeName.find( "UnityEngine.Color" ) != std::string::npos;
}

static void* FindInstanceFieldByName( void* klass, const char* fieldName ) {
    if ( !klass || !fieldName ) return nullptr;
    return api::class_get_field_from_name( klass, fieldName );
}

// Serialize a field value dynamically
json RuntimeDumper::SerializeFieldValue( void* obj, void* field, void* fieldType, int depth ) {
    if ( depth > kMaxDynamicDepth ) {
        return json::object();
    }

    __try {
        const char* typeName = api::type_get_name( fieldType );
        if ( !typeName ) return nullptr;

        std::string typeStr( typeName );
        int32_t offset = api::field_get_offset( field );
        uintptr_t fieldAddr = ( uintptr_t ) obj + offset;

        // DEBUG: Log field type for map01
        const char* fieldName = api::field_get_name( field );
        if ( fieldName && depth == 0 ) {
            std::string fieldNameStr( fieldName );
            if ( fieldNameStr.find( "level" ) != std::string::npos ||
                 fieldNameStr.find( "scene" ) != std::string::npos ||
                 fieldNameStr.find( "art" ) != std::string::npos ) {
                Log( "      [DEBUG] Field: " + fieldNameStr + " -> Type: " + typeStr );
            }
        }

    // IMPORTANT: Check for arrays FIRST before primitives!
    // Otherwise "Int32[]" matches IsPrimitiveType because it contains "Int32"
    if ( typeStr.find( "[]" ) != std::string::npos ) {
        __try {
            bool isParamValueAtom = typeStr.find( "ParamValueAtom" ) != std::string::npos;
            if ( depth >= kMaxCollectionDepth || ( isParamValueAtom && depth >= 6 ) ) {
                return json::array();
            }

            void* arrayPtr = *( void** ) fieldAddr;
            if ( !arrayPtr ) {
                return json::array();
            }

            // IL2CPP arrays have length at offset 0x18
            int32_t arrayLength = *( int32_t* ) ( ( uintptr_t ) arrayPtr + 0x18 );
            if ( arrayLength <= 0 || arrayLength > 10000 ) {
                return json::array();
            }

            if ( arrayLength > kMaxCollectionItems ) arrayLength = kMaxCollectionItems;

            json arrayResult = json::array();

            // Array elements start at offset 0x20
            if ( typeStr.find( "Int32[]" ) != std::string::npos ) {
                int32_t* elements = ( int32_t* ) ( ( uintptr_t ) arrayPtr + 0x20 );
                for ( int32_t i = 0; i < arrayLength; i++ ) {
                    arrayResult.push_back( elements[i] );
                }
            } else if ( typeStr.find( "String[]" ) != std::string::npos ) {
                void** elements = ( void** ) ( ( uintptr_t ) arrayPtr + 0x20 );
                for ( int32_t i = 0; i < arrayLength; i++ ) {
                    void* strPtr = elements[i];
                    if ( strPtr ) {
                        uint32_t length = *( uint32_t* ) ( ( uintptr_t ) strPtr + 0x10 );
                        wchar_t* chars = ( wchar_t* ) ( ( uintptr_t ) strPtr + 0x14 );
                        if ( length > 0 && length < 10000 && chars ) {
                            std::wstring wstr( chars, length );
                            arrayResult.push_back( std::string( wstr.begin(), wstr.end() ) );
                        } else {
                            arrayResult.push_back( "" );
                        }
                    } else {
                        arrayResult.push_back( nullptr );
                    }
                }
            } else {
                // For other array types - need to check if elements are value types (structs) or reference types (classes)
                // Try to get element class to check if it's a value type
                void* arrayClass = api::object_get_class( arrayPtr );

                if ( arrayClass ) {
                    void* elementClass = api::class_get_element_class( arrayClass );

                    if ( elementClass ) {
                        bool isValueType = api::class_is_valuetype( elementClass );

                        if ( isValueType ) {
                            // Value type array (structs) - elements stored inline
                            const char* elemClassName = api::class_get_name( elementClass );
                            std::string elemClassStr = elemClassName ? elemClassName : "";

                            // Special handling for ParamValueAtom - class_get_instance_size crashes on it
                            if ( elemClassStr == "ParamValueAtom" ) {
                                // ParamValueAtom struct: valueBit64 (Int64 at 0x10), valueString (String at 0x18)
                                int32_t elementSize = 0x20; // 32 bytes
                                uintptr_t elementsStart = ( uintptr_t ) arrayPtr + 0x20;
                                for ( int32_t i = 0; i < arrayLength; i++ ) {
                                    void* elementAddr = ( void* ) ( elementsStart + ( i * elementSize ) );
                                    json structData = json::object();

                                    // Extract valueBit64 field
                                    int64_t valueBit64 = *( int64_t* ) ( ( uintptr_t ) elementAddr + 0x10 );
                                    structData["valueBit64"] = valueBit64;

                                    // Extract valueString field
                                    void* valueStringPtr = *( void** ) ( ( uintptr_t ) elementAddr + 0x18 );
                                    if ( valueStringPtr ) {
                                        __try {
                                            uint32_t strLength = *( uint32_t* ) ( ( uintptr_t ) valueStringPtr + 0x10 );
                                            if ( strLength > 0 && strLength < 10000 ) {
                                                wchar_t* chars = ( wchar_t* ) ( ( uintptr_t ) valueStringPtr + 0x14 );
                                                std::wstring wstr( chars, strLength );
                                                structData["valueString"] = std::string( wstr.begin(), wstr.end() );
                                            } else {
                                                structData["valueString"] = "";
                                            }
                                        } __except( EXCEPTION_EXECUTE_HANDLER ) {
                                            structData["valueString"] = "";
                                        }
                                    } else {
                                        structData["valueString"] = "";
                                    }

                                    arrayResult.push_back( structData );
                                }
                            } else {
                                // Normal struct processing
                                __try {
                                    int32_t elementSize = api::class_get_instance_size( elementClass );

                                    if ( elementSize > 0 && elementSize < 1000 ) {
                                        uintptr_t elementsStart = ( uintptr_t ) arrayPtr + 0x20;
                            for ( int32_t i = 0; i < arrayLength; i++ ) {
                                // For struct, pass the address directly (it's inline, not a pointer)
                                void* elementAddr = ( void* ) ( elementsStart + ( i * elementSize ) );
                                json structData = json::object();

                                // Iterate fields of the struct
                                void* iter = nullptr;
                                while ( void* field = api::class_get_fields( elementClass, &iter ) ) {
                                    __try {
                                        uint32_t flags = api::field_get_flags( field );
                                        if ( flags & 0x0010 ) continue; // Skip static fields

                                        const char* fieldName = api::field_get_name( field );
                                        if ( !fieldName ) continue;

                                        void* fieldType = api::field_get_type( field );
                                        if ( !fieldType ) continue;

                                        json fieldValue = SerializeFieldValue( elementAddr, field, fieldType, depth + 1 );
                                        // Include field even if null (for consistency)
                                        structData[fieldName] = fieldValue;
                                    } __except( EXCEPTION_EXECUTE_HANDLER ) {
                                        continue;
                                    }
                                }
                                        arrayResult.push_back( structData );
                                    }
                                }
                                } __except( EXCEPTION_EXECUTE_HANDLER ) {
                                    return json::array();
                                }
                            }
                        } else {
                            // Reference type array (classes) - elements are pointers
                            void** elements = ( void** ) ( ( uintptr_t ) arrayPtr + 0x20 );
                            for ( int32_t i = 0; i < arrayLength; i++ ) {
                                if ( elements[i] ) {
                                    arrayResult.push_back( SerializeObjectDynamic( elements[i], depth + 1 ) );
                                } else {
                                    arrayResult.push_back( nullptr );
                                }
                            }
                        }
                    }
                }
            }
            return arrayResult;
        } __except( EXCEPTION_EXECUTE_HANDLER ) {
            return json::array();
        }
    }

    // Handle Dictionary BEFORE primitives (Dictionary<String,Int32> contains "String"!)
    if ( typeStr.find( "Dictionary" ) != std::string::npos ) {
        __try {
            if ( depth >= kMaxCollectionDepth ) return json::object();
            void* dictPtr = *( void** ) fieldAddr;
            if ( !dictPtr ) {
                return json::object( );
            }
            return SerializeDictionary( dictPtr, depth + 1 );
        } __except( EXCEPTION_EXECUTE_HANDLER ) {
            return json::object( );
        }
    }

    // Handle List BEFORE primitives (List<String> contains "String"!)
    if ( typeStr.find( "List" ) != std::string::npos ) {
        __try {
            if ( depth >= kMaxCollectionDepth ) return json::array();
            void* listPtr = *( void** ) fieldAddr;
            if ( !listPtr ) {
                return json::array( );
            }
            return SerializeList( listPtr, depth + 1 );
        } __except( EXCEPTION_EXECUTE_HANDLER ) {
            return json::array( );
        }
    }

    // Handle primitives (AFTER arrays, lists, dictionaries!)
    if ( IsPrimitiveType( typeStr ) ) {
        if ( typeStr.find( "String" ) != std::string::npos ) {
            void* strPtr = *( void** ) fieldAddr;
            if ( strPtr ) {
                uint32_t length = *( uint32_t* ) ( ( uintptr_t ) strPtr + 0x10 );
                wchar_t* chars = ( wchar_t* ) ( ( uintptr_t ) strPtr + 0x14 );
                if ( length > 0 && chars ) {
                    std::wstring wstr( chars, length );
                    return json( std::string( wstr.begin( ), wstr.end( ) ) );
                }
            }
            return json( "" );
        } else if ( typeStr.find( "Int32" ) != std::string::npos || typeStr.find( "UInt32" ) != std::string::npos ) {
            return json( *( int32_t* ) fieldAddr );
        } else if ( typeStr.find( "Int64" ) != std::string::npos || typeStr.find( "UInt64" ) != std::string::npos ) {
            return json( *( int64_t* ) fieldAddr );
        } else if ( typeStr.find( "Single" ) != std::string::npos ) {
            return json( *( float* ) fieldAddr );
        } else if ( typeStr.find( "Double" ) != std::string::npos ) {
            return json( *( double* ) fieldAddr );
        } else if ( typeStr.find( "Boolean" ) != std::string::npos ) {
            return json( *( bool* ) fieldAddr );
        }
    }

    // Handle Enums - use IL2CPP API to properly detect enums
    // Try to get the type's class to check if it's an enum
    __try {
        void* typeClass = nullptr;

        // Parse namespace and class name from type string to get the enum class
        size_t lastDot = typeStr.rfind( '.' );
        if ( lastDot != std::string::npos ) {
            std::string namespacePart = typeStr.substr( 0, lastDot );
            std::string classPart = typeStr.substr( lastDot + 1 );

            // Try to find the type class
            void* domain = api::get_domain();
            if ( domain ) {
                size_t asmCount = 0;
                void** assemblies = api::get_assemblies( domain, &asmCount );
                for ( size_t a = 0; a < asmCount && a < 50; ++a ) {  // Limit search
                    void* assembly = assemblies[a];
                    if ( !assembly ) continue;
                    void* image = api::assembly_get_image( assembly );
                    if ( !image ) continue;
                    typeClass = api::class_from_name( image, namespacePart.c_str(), classPart.c_str() );
                    if ( typeClass ) break;
                }
            }
        }

        // Check if this is an enum using IL2CPP API
        if ( typeClass && api::class_is_enum && api::class_is_enum( typeClass ) ) {
            // Enums are stored as Int32 inline - get the value
            int32_t enumValue = *( int32_t* ) fieldAddr;

            // Get enum name
            std::string enumName = GetEnumName( typeClass, enumValue );
            return json( enumName );
        }
    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        // Fall through
    }

    // Handle Unity types
    if ( typeStr.find( "UnityEngine.Vector3" ) != std::string::npos ) {
        float* vec = ( float* ) fieldAddr;
        json result;
        result["x"] = vec[0];
        result["y"] = vec[1];
        result["z"] = vec[2];
        return result;
    }
    if ( typeStr.find( "UnityEngine.Quaternion" ) != std::string::npos ) {
        float* quat = ( float* ) fieldAddr;
        json result;
        result["x"] = quat[0];
        result["y"] = quat[1];
        result["z"] = quat[2];
        result["w"] = quat[3];
        return result;
    }

    // Handle complex types (structs, classes)
    // Check if it's a value type (struct) or reference type (class)
    void* fieldClass = nullptr;

    // For reference types, dereference pointer
    void* ptr = nullptr;
    __try {
        ptr = *( void** ) fieldAddr;
    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        // Can't dereference, might be a value type or invalid pointer
        ptr = nullptr;
    }

    // Try to get the class from the type
    // We need a way to get Il2CppClass* from Il2CppType*
    // For now, try to check if it's a pointer (reference type) or inline (value type)

    // If typeStr contains known struct names, treat as inline
    if ( typeStr.find( "TriggerShapeData" ) != std::string::npos ) {
        // Handle TriggerShapeData struct inline
        json shapeResult;
        uintptr_t shapeAddr = fieldAddr;

        // type (int32) at 0x10 offset from struct start
        int32_t shapeType = *( int32_t* ) ( shapeAddr + 0x10 );
        const char* shapeTypeStr = "Unknown";
        if ( shapeType == 0 ) shapeTypeStr = "None";
        else if ( shapeType == 1 ) shapeTypeStr = "Box";
        else if ( shapeType == 2 ) shapeTypeStr = "Sphere";
        shapeResult["type"] = shapeTypeStr;

        // position at 0x14
        float* position = ( float* ) ( shapeAddr + 0x14 );
        shapeResult["position"]["x"] = position[0];
        shapeResult["position"]["y"] = position[1];
        shapeResult["position"]["z"] = position[2];

        // eulerAngles at 0x20
        float* eulerAngles = ( float* ) ( shapeAddr + 0x20 );
        shapeResult["eulerAngles"]["x"] = eulerAngles[0];
        shapeResult["eulerAngles"]["y"] = eulerAngles[1];
        shapeResult["eulerAngles"]["z"] = eulerAngles[2];

        // size at 0x2C
        float* size = ( float* ) ( shapeAddr + 0x2C );
        shapeResult["size"]["x"] = size[0];
        shapeResult["size"]["y"] = size[1];
        shapeResult["size"]["z"] = size[2];

        // radius at 0x38
        shapeResult["radius"] = *( float* ) ( shapeAddr + 0x38 );

        return shapeResult;
    }

        // Try as reference type (pointer)
        if ( ptr ) {
            return SerializeObjectDynamic( ptr, depth + 1 );
        }

        return nullptr;

    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        // If we can't serialize this field, return an empty object
        // This allows the serialization to continue even if one field fails
        return json::object( );
    }
}

// Get enum name from value
std::string RuntimeDumper::GetEnumName( void* enumClass, int32_t enumValue ) {
    if ( !enumClass ) return std::to_string( enumValue );

    __try {
        // Iterate through static fields to find matching enum value
        void* iter = nullptr;
        while ( void* field = api::class_get_fields( enumClass, &iter ) ) {
            uint32_t flags = api::field_get_flags( field );

            // Check if static field (enum values are static)
            if ( !( flags & 0x0010 ) ) continue;

            const char* fieldName = api::field_get_name( field );
            if ( !fieldName ) continue;

            // Skip the "value__" field (underlying type storage)
            if ( std::string( fieldName ) == "value__" ) continue;

            // Get the static value
            void* staticValue = nullptr;
            api::field_static_get_value( field, &staticValue );

            // Compare with our target value
            int32_t fieldValue = ( int32_t ) ( uintptr_t ) staticValue;
            if ( fieldValue == enumValue ) {
                return std::string( fieldName );
            }
        }
    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        // Fall through to return number
    }

    // If not found, return the number as string
    return std::to_string( enumValue );
}

// Serialize Dictionary dynamically
json RuntimeDumper::SerializeDictionary( void* dictObj, int depth ) {
    if ( !dictObj || depth > kMaxDynamicDepth || depth >= kMaxCollectionDepth ) return json::object( );

    json result = json::object( );

    __try {
        void* dictClass = api::object_get_class( dictObj );
        if ( !dictClass ) return result;

        // Get _count
        void* countField = api::class_get_field_from_name( dictClass, "_count" );
        if ( !countField ) return result;

        int32_t offset = api::field_get_offset( countField );
        int32_t count = *( int32_t* ) ( ( uintptr_t ) dictObj + offset );

        if ( count == 0 ) return result;
        const int maxItems = depth <= 2 ? kMaxTopLevelCollectionItems : kMaxCollectionItems;
        if ( count > maxItems ) count = maxItems;

        // Get _entries
        void* entriesField = api::class_get_field_from_name( dictClass, "_entries" );
        if ( !entriesField ) return result;

        offset = api::field_get_offset( entriesField );
        void* entriesArray = *( void** ) ( ( uintptr_t ) dictObj + offset );
        if ( !entriesArray ) return result;

        // Try to get key type to check if it's an enum
        void* entriesArrayClass = api::object_get_class( entriesArray );
        void* entryClass = entriesArrayClass ? api::class_get_element_class( entriesArrayClass ) : nullptr;
        void* keyFieldInEntry = entryClass ? api::class_get_field_from_name( entryClass, "key" ) : nullptr;
        void* keyType = keyFieldInEntry ? api::field_get_type( keyFieldInEntry ) : nullptr;
        const char* keyTypeName = keyType ? api::type_get_name( keyType ) : nullptr;
        bool keyIsEnum = false;
        void* keyEnumClass = nullptr;

        if ( keyTypeName ) {
            std::string keyTypeStr( keyTypeName );

            // Log key type for debugging (only at depth 0 to avoid spam)
            if ( depth == 0 || depth <= 3 ) {
                Log( "  [DICT D" + std::to_string( depth ) + "] KeyType: " + keyTypeStr );
            }

            // Check if key type looks like an enum
            if ( keyTypeStr.find( "GEnums." ) != std::string::npos ||
                 keyTypeStr.find( ".Enums." ) != std::string::npos ||
                 ( keyTypeStr.find( "Enum" ) != std::string::npos && keyTypeStr.find( "." ) != std::string::npos ) ||
                 keyTypeStr.find( "ComponentType" ) != std::string::npos ) {  // Add explicit check for ComponentType
                // Try to get the enum class
                size_t lastDot = keyTypeStr.rfind( '.' );
                if ( lastDot != std::string::npos ) {
                    std::string namespacePart = keyTypeStr.substr( 0, lastDot );
                    std::string classPart = keyTypeStr.substr( lastDot + 1 );

                    // Search for the enum class
                    void* domain = api::get_domain();
                    if ( domain ) {
                        size_t asmCount = 0;
                        void** assemblies = api::get_assemblies( domain, &asmCount );
                        for ( size_t a = 0; a < asmCount; ++a ) {
                            void* assembly = assemblies[a];
                            if ( !assembly ) continue;
                            void* image = api::assembly_get_image( assembly );
                            if ( !image ) continue;
                            void* enumKlass = api::class_from_name( image, namespacePart.c_str(), classPart.c_str() );
                            if ( enumKlass ) {
                                keyEnumClass = enumKlass;
                                keyIsEnum = true;
                                if ( depth <= 3 ) {
                                    Log( "  [DICT D" + std::to_string( depth ) + "] Found enum class: " +
                                         namespacePart + "." + classPart );
                                }
                                break;
                            }
                        }
                    }
                }
                if ( !keyIsEnum && ( depth <= 3 ) ) {
                    Log( "  [DICT D" + std::to_string( depth ) + "] Could not find enum class" );
                }
            }
        }

        // Iterate entries
        for ( int32_t i = 0; i < count; ++i ) {
            uintptr_t entryAddr = ( uintptr_t ) entriesArray + 0x20 + ( i * 24 );

            // Try to extract key as string or int
            std::string keyStr;
            bool keyExtracted = false;

            // Always try as string pointer FIRST (safer with exception handling)
            uintptr_t keyAsPtr = *( uintptr_t* ) ( entryAddr + 8 );

            __try {
                void* keyPtr = ( void* ) keyAsPtr;
                void* keyClass = api::object_get_class( keyPtr );
                if ( keyClass ) {
                    const char* keyClassName = api::class_get_name( keyClass );
                    if ( keyClassName && std::string( keyClassName ) == "String" ) {
                        uint32_t length = *( uint32_t* ) ( ( uintptr_t ) keyPtr + 0x10 );
                        wchar_t* chars = ( wchar_t* ) ( ( uintptr_t ) keyPtr + 0x14 );
                        if ( length > 0 && length < 10000 && chars ) {
                            std::wstring wstr( chars, length );
                            keyStr = std::string( wstr.begin( ), wstr.end( ) );
                            keyExtracted = true;
                        }
                    }
                }
            } __except( EXCEPTION_EXECUTE_HANDLER ) {
                // Not a string, will try int below
            }

            // If string extraction failed, try as int32
            if ( !keyExtracted ) {
                int32_t keyInt = *( int32_t* ) ( entryAddr + 8 );
                if ( keyInt != 0 || count == 1 ) {  // Include zero if it's the only key
                    // If key is enum, get enum name
                    if ( keyIsEnum && keyEnumClass ) {
                        keyStr = GetEnumName( keyEnumClass, keyInt );
                    } else {
                        keyStr = std::to_string( keyInt );
                    }
                }
            }

            if ( !keyStr.empty( ) ) {
                // Get value (at offset 16)
                // For reference types, it's a pointer
                // For value types (Int32, enum, etc.), it's stored inline
                uintptr_t valueAsPtr = *( uintptr_t* ) ( entryAddr + 16 );

                // Check if this looks like a valid pointer
                bool isValuePointer = ( valueAsPtr > 0x10000 && valueAsPtr < 0x7FFFFFFFFFFF );

                if ( isValuePointer ) {
                    // Reference type - dereference pointer
                    void* valuePtr = ( void* ) valueAsPtr;
                    result[keyStr] = SerializeObjectDynamic( valuePtr, depth + 1 );
                } else {
                    // Value type (Int32, enum, etc.) - read directly
                    int32_t valueInt = *( int32_t* ) ( entryAddr + 16 );
                    result[keyStr] = valueInt;
                }
            }
        }

    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        Log( "  [WARN] Exception in SerializeDictionary" );
    }

    return result;
}

// Serialize List dynamically
json RuntimeDumper::SerializeList( void* listObj, int depth ) {
    if ( !listObj || depth > kMaxDynamicDepth || depth >= kMaxCollectionDepth ) return json::array( );

    json result = json::array( );

    __try {
        void* listClass = api::object_get_class( listObj );
        if ( !listClass ) return result;

        // Get _size
        void* sizeField = api::class_get_field_from_name( listClass, "_size" );
        if ( !sizeField ) return result;

        int32_t offset = api::field_get_offset( sizeField );
        int32_t size = *( int32_t* ) ( ( uintptr_t ) listObj + offset );

        if ( size == 0 ) return result;
        if ( size < 0 || size > 1000000 ) return result;
        const int maxItems = depth <= 2 ? kMaxTopLevelCollectionItems : kMaxCollectionItems;
        if ( size > maxItems ) size = maxItems;

        // NO size limits - user wants complete data
        // Memory managed by writing fields separately and clearing visited set
        // If a specific field causes crash, exception handling will skip it

        // Get _items array
        void* itemsField = api::class_get_field_from_name( listClass, "_items" );
        if ( !itemsField ) return result;

        offset = api::field_get_offset( itemsField );
        void* itemsArray = *( void** ) ( ( uintptr_t ) listObj + offset );
        if ( !itemsArray ) return result;

        // Check if list elements are value types (structs) or reference types (classes)
        void* arrayClass = api::object_get_class( itemsArray );
        void* elementClass = arrayClass ? api::class_get_element_class( arrayClass ) : nullptr;
        bool isValueType = elementClass && api::class_is_valuetype( elementClass );

        // Always log value type detection (for debugging)
        if ( elementClass ) {
            const char* elemClassName = api::class_get_name( elementClass );
            if ( depth <= 5 ) {  // Log for reasonable depths
                std::string typeInfo = "[LIST D" + std::to_string( depth ) + "] " +
                                      std::string( elemClassName ? elemClassName : "?" ) +
                                      " isValueType=" + ( isValueType ? "YES" : "NO" );
                Log( typeInfo );
            }
        }

        if ( isValueType ) {
            // Value type list (structs or primitives) - elements stored inline in array
            // Check element type name first to handle primitives
            const char* elemClassName = api::class_get_name( elementClass );
            std::string elemTypeStr = elemClassName ? elemClassName : "";

            if ( depth <= 5 ) {
                Log( "  [LIST D" + std::to_string( depth ) + "] ValueType: " + elemTypeStr + ", Size=" + std::to_string( size ) );
            }

            // For primitive value types, read values directly without calling class_get_instance_size
            if ( elemTypeStr == "UInt64" || elemTypeStr == "Int64" ) {
                    __try {
                        if ( depth <= 5 ) {
                            Log( "  [LIST D" + std::to_string( depth ) + "] Processing " + elemTypeStr + " list, size=" + std::to_string( size ) );
                        }
                        uintptr_t elementsStart = ( uintptr_t ) itemsArray + 0x20;
                        for ( int32_t i = 0; i < size; ++i ) {
                            int64_t value = *( int64_t* ) ( elementsStart + ( i * 8 ) );
                            json item = json::object();
                            item["valueBit64"] = value;
                            result.push_back( item );
                        }
                        if ( depth <= 5 ) {
                            Log( "  [LIST D" + std::to_string( depth ) + "] Successfully processed " + std::to_string( size ) + " items" );
                        }
                    } __except( EXCEPTION_EXECUTE_HANDLER ) {
                        Log( "  [WARN] Exception processing " + elemTypeStr + " list at depth " + std::to_string( depth ) );
                    }
                } else if ( elemTypeStr == "Int32" ) {
                    uintptr_t elementsStart = ( uintptr_t ) itemsArray + 0x20;
                    for ( int32_t i = 0; i < size; ++i ) {
                        int32_t value = *( int32_t* ) ( elementsStart + ( i * 4 ) );
                        json item = json::object();
                        item["valueBit64"] = value;
                        result.push_back( item );
                    }
                } else if ( elemTypeStr == "Single" || elemTypeStr == "Float" ) {
                    uintptr_t elementsStart = ( uintptr_t ) itemsArray + 0x20;
                    for ( int32_t i = 0; i < size; ++i ) {
                        float value = *( float* ) ( elementsStart + ( i * 4 ) );
                        json item = json::object();
                        item["valueBit64"] = *reinterpret_cast<int32_t*>( &value );
                        result.push_back( item );
                    }
                } else {
                    // For complex structs, get element size and iterate fields
                    __try {
                        int32_t elementSize = api::class_get_instance_size( elementClass );

                        if ( depth <= 5 ) {
                            Log( "  [LIST D" + std::to_string( depth ) + "] Struct ElementSize=" + std::to_string( elementSize ) );
                        }

                        if ( elementSize > 0 && elementSize < 1000 ) {
                            uintptr_t elementsStart = ( uintptr_t ) itemsArray + 0x20;
                            for ( int32_t i = 0; i < size; ++i ) {
                                void* elementAddr = ( void* ) ( elementsStart + ( i * elementSize ) );
                                json structData = json::object();

                                // Iterate fields of the struct
                                void* iter = nullptr;
                                while ( void* field = api::class_get_fields( elementClass, &iter ) ) {
                                    __try {
                                        uint32_t flags = api::field_get_flags( field );
                                        if ( flags & 0x0010 ) continue; // Skip static fields

                                        const char* fieldName = api::field_get_name( field );
                                        if ( !fieldName ) continue;

                                        void* fieldType = api::field_get_type( field );
                                        if ( !fieldType ) continue;

                                        json fieldValue = SerializeFieldValue( elementAddr, field, fieldType, depth + 1 );
                                        // Include field even if null (for consistency)
                                        structData[fieldName] = fieldValue;
                                    } __except( EXCEPTION_EXECUTE_HANDLER ) {
                                        continue;
                                    }
                                }
                                result.push_back( structData );
                            }
                        } else {
                            if ( depth <= 5 ) {
                                Log( "  [LIST D" + std::to_string( depth ) + "] SKIPPED: elementSize " + std::to_string( elementSize ) + " out of range" );
                            }
                        }
                    } __except( EXCEPTION_EXECUTE_HANDLER ) {
                        if ( depth <= 5 ) {
                            Log( "  [WARN] Exception getting struct element size for " + elemTypeStr );
                        }
                    }
                }
        } else {
            // Reference type list (classes) - elements are pointers
            // IL2CPP arrays start at 0x20
            __try {
                for ( int32_t i = 0; i < size; ++i ) {
                    __try {
                        void* item = *( void** ) ( ( uintptr_t ) itemsArray + 0x20 + ( i * 8 ) );
                        if ( item ) {
                            result.push_back( SerializeObjectDynamic( item, depth + 1 ) );
                        } else {
                            result.push_back( nullptr );
                        }
                    } __except( EXCEPTION_EXECUTE_HANDLER ) {
                        if ( depth <= 5 ) {
                            Log( "  [WARN] Exception processing list item " + std::to_string( i ) + " at depth " + std::to_string( depth ) );
                        }
                        result.push_back( nullptr );
                    }
                }
            } __except( EXCEPTION_EXECUTE_HANDLER ) {
                if ( depth <= 5 ) {
                    Log( "  [WARN] Exception in reference type list iteration at depth " + std::to_string( depth ) );
                }
            }
        }

    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        Log( "  [WARN] Exception in SerializeList" );
    }

    return result;
}

// Thread-local visited set for circular reference detection
thread_local std::unordered_set<void*> g_visitedObjects;

// Dynamically serialize any IL2CPP object
json RuntimeDumper::SerializeObjectDynamic( void* obj, int depth ) {
    if ( !obj || depth > kMaxDynamicDepth ) return json::object( );

    // Reset visited set at depth 0 (top level)
    if ( depth == 0 ) {
        g_visitedObjects.clear();
    }

    // CRITICAL: Check for circular reference BEFORE processing
    if ( g_visitedObjects.find( obj ) != g_visitedObjects.end() ) {
        // Circular reference detected - return marker to prevent infinite loop
        return json( "[circular_ref]" );
    }

    // Mark this object as visited
    g_visitedObjects.insert( obj );

    __try {
        void* klass = api::object_get_class( obj );
        if ( !klass ) {
            if ( depth == 0 ) Log( "  [WARN] Could not get object class" );
            return json::object( );
        }

        const char* className = api::class_get_name( klass );
        const char* namespaceName = api::class_get_namespace( klass );
        if ( !className || !namespaceName ) {
            if ( depth == 0 ) Log( "  [WARN] Could not get class name/namespace" );
            return json::object( );
        }

        std::string fullName = std::string( namespaceName ) + "." + className;
        if ( ShouldShortCircuitType( fullName ) ) {
            return json( "[skipped_runtime_type]" );
        }

        // Handle primitives
        if ( fullName == "System.String" ) {
            __try {
                uint32_t length = *( uint32_t* ) ( ( uintptr_t ) obj + 0x10 );
                if ( length > 0 && length < 100000 ) {
                    wchar_t* chars = ( wchar_t* ) ( ( uintptr_t ) obj + 0x14 );
                    if ( chars ) {
                        std::wstring wstr( chars, length );
                        return json( std::string( wstr.begin( ), wstr.end( ) ) );
                    }
                }
                return json( "" );
            } __except( EXCEPTION_EXECUTE_HANDLER ) {
                return json( "" );
            }
        }

        // Handle Unity types (value types - inline data)
        if ( fullName == "UnityEngine.Vector3" ) {
            __try {
                float* vec = ( float* ) obj;
                json result;
                result["x"] = vec[0];
                result["y"] = vec[1];
                result["z"] = vec[2];
                return result;
            } __except( EXCEPTION_EXECUTE_HANDLER ) {
                return json::object( );
            }
        }

        // Handle Dictionary
        if ( fullName.find( "Dictionary" ) != std::string::npos ) {
            return SerializeDictionary( obj, depth + 1 );
        }

        // Handle List
        if ( fullName.find( "List" ) != std::string::npos ) {
            return SerializeList( obj, depth + 1 );
        }

        // Interactive export needs a stable, minimal schema. Serialize these types explicitly
        // instead of walking the full runtime object graph.
        if ( fullName == "Beyond.Gameplay.ParamKeyValue" ) {
            json result = json::object();
            if ( void* keyField = FindInstanceFieldByName( klass, "key" ) ) {
                void* keyType = api::field_get_type( keyField );
                result["key"] = SerializeFieldValue( obj, keyField, keyType, depth + 1 );
            }
            if ( void* valueField = FindInstanceFieldByName( klass, "value" ) ) {
                void* valueType = api::field_get_type( valueField );
                result["value"] = SerializeFieldValue( obj, valueField, valueType, depth + 1 );
            }
            return result;
        }

        if ( fullName == "Beyond.Gameplay.Core.PropertyStateData" ) {
            json result = json::object();
            if ( void* optionNameField = FindInstanceFieldByName( klass, "optionName" ) ) {
                void* optionNameType = api::field_get_type( optionNameField );
                result["optionName"] = SerializeFieldValue( obj, optionNameField, optionNameType, depth + 1 );
            }
            return result;
        }

        if ( fullName == "Beyond.Gameplay.Core.InteractiveTemplateVariant" ) {
            json result = json::object();
            const char* variantFields[] = {
                "modelId",
                "factionIndex",
                "delayToRecycleTime",
                "delayRecyclePerformTime",
                "facOccDis",
                "hideInDialog",
                "bornTag",
                "mountPoints",
                "aoiRadiusType",
                "diffProperties",
                "componentDiffProperties",
                "globalVarDiff",
                "mapVarDiff"
            };

            for ( const char* fieldName : variantFields ) {
                if ( void* field = FindInstanceFieldByName( klass, fieldName ) ) {
                    void* fieldType = api::field_get_type( field );
                    result[fieldName] = SerializeFieldValue( obj, field, fieldType, depth + 1 );
                }
            }
            return result;
        }

        if ( fullName.find( "ComponentData" ) != std::string::npos ||
             fullName.find( "ControllerData" ) != std::string::npos ) {
            json result = json::object();
            result["$type"] = fullName + ", Gameplay.Beyond";

            const char* componentFields[] = {
                "modelId",
                "modelScale",
                "propertyStateData",
                "propertyList"
            };

            for ( const char* fieldName : componentFields ) {
                if ( void* field = FindInstanceFieldByName( klass, fieldName ) ) {
                    void* fieldType = api::field_get_type( field );
                    result[fieldName] = SerializeFieldValue( obj, field, fieldType, depth + 1 );
                }
            }
            return result;
        }

        if ( fullName == "Beyond.Gameplay.InteractiveTemplateData" ) {
            json result = json::object();
            const char* interactiveFields[] = {
                "configProperties",
                "componentList",
                "templateVariant",
                "bornTag",
                "factionIndex",
                "hideInDialog",
                "aoiRadiusType"
            };

            for ( const char* fieldName : interactiveFields ) {
                if ( void* field = FindInstanceFieldByName( klass, fieldName ) ) {
                    void* fieldType = api::field_get_type( field );
                    result[fieldName] = SerializeFieldValue( obj, field, fieldType, depth + 1 );
                }
            }
            return result;
        }

        // Handle complex object - iterate fields
        json result = json::object( );
        int fieldCount = 0;
        int totalFieldsFound = 0;

        // Iterate through parent classes first to get inherited fields
        void* currentClass = klass;
        std::vector<void*> classHierarchy;

        // Build class hierarchy (parent -> child order)
        while ( currentClass ) {
            classHierarchy.push_back( currentClass );
            currentClass = api::class_get_parent( currentClass );
            // Stop at System.Object or if parent is null
            if ( currentClass ) {
                const char* parentName = api::class_get_name( currentClass );
                if ( parentName && std::string( parentName ) == "Object" ) {
                    break;
                }
            }
        }

        // Iterate from parent to child (reverse order) so child fields can override
        for ( auto it = classHierarchy.rbegin(); it != classHierarchy.rend(); ++it ) {
            void* iterClass = *it;
            void* iter = nullptr;
            while ( void* field = api::class_get_fields( iterClass, &iter ) ) {
            __try {
                uint32_t flags = api::field_get_flags( field );

                // Skip static fields
                if ( flags & 0x0010 ) continue;

                const char* fieldName = api::field_get_name( field );
                if ( !fieldName ) continue;

                totalFieldsFound++;

                // Skip backing fields (keep only public properties)
                std::string fieldNameStr( fieldName );
                if ( fieldNameStr.find( "__BackingField" ) != std::string::npos ) {
                    // Extract property name from backing field
                    size_t start = fieldNameStr.find( '<' ) + 1;
                    size_t end = fieldNameStr.find( '>' );
                    if ( start != std::string::npos && end != std::string::npos ) {
                        fieldNameStr = fieldNameStr.substr( start, end - start );
                    }
                }

                if ( ShouldSkipRuntimeField( fullName, fieldNameStr ) ) {
                    continue;
                }

                void* fieldType = api::field_get_type( field );
                if ( !fieldType ) continue;

                json fieldValue = SerializeFieldValue( obj, field, fieldType, depth );

                if ( !fieldValue.is_null( ) ) {
                    result[fieldNameStr] = fieldValue;
                    fieldCount++;
                }
            } __except( EXCEPTION_EXECUTE_HANDLER ) {
                // Skip this field if it causes an exception
                continue;
            }
            }  // End of fields iteration for this class
        }  // End of class hierarchy iteration

        // Only log for top-level objects
        // if ( depth == 0 ) {
        //     Log( "  [DEBUG] Found " + std::to_string( totalFieldsFound ) + " instance fields" );
        //     Log( "  [DEBUG] Serialized " + std::to_string( fieldCount ) + " fields successfully" );
        // }
        return result;

    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        if ( depth == 0 ) Log( "  [ERROR] Critical exception in SerializeObjectDynamic" );
        return json::object( );
    }
}

// Helper to get field value from object
void* GetFieldValue( void* obj, void* field ) {
    if ( !obj || !field ) return nullptr;

    // Get field offset
    int32_t offset = api::field_get_offset( field );
    if ( offset < 0 ) return nullptr;

    // Calculate field address
    return ( void* ) ( ( uintptr_t ) obj + offset );
}

// Serialize Vector3
json RuntimeDumper::SerializeVector3( void* obj ) {
    if ( !obj ) return json::object( );

    float* vec = ( float* ) obj;
    json result;
    result["x"] = vec[0];
    result["y"] = vec[1];
    result["z"] = vec[2];
    return result;
}

// Serialize Quaternion (as euler angles)
json RuntimeDumper::SerializeQuaternion( void* obj ) {
    if ( !obj ) return json::object( );

    float* quat = ( float* ) obj;
    json result;
    result["x"] = quat[0];
    result["y"] = quat[1];
    result["z"] = quat[2];
    return result;
}

// Serialize Color
json RuntimeDumper::SerializeColor( void* obj ) {
    if ( !obj ) return json::object( );

    float* color = ( float* ) obj;
    json result;
    result["r"] = color[0];
    result["g"] = color[1];
    result["b"] = color[2];
    result["a"] = color[3];
    return result;
}

// Main object serialization
json RuntimeDumper::SerializeObject( void* obj, void* klass ) {
    if ( !obj || !klass ) return json( nullptr );

    // Get class name
    const char* className = api::class_get_name( klass );
    const char* namespaceName = api::class_get_namespace( klass );

    std::string fullName = std::string( namespaceName ) + "." + className;

    // Handle primitive types
    if ( fullName == "System.String" ) {
        const char* str = *( const char** ) obj;
        return str ? json( str ) : json( "" );
    }
    if ( fullName == "System.Int32" ) {
        return json( *( int32_t* ) obj );
    }
    if ( fullName == "System.Single" ) {
        return json( *( float* ) obj );
    }
    if ( fullName == "System.Double" ) {
        return json( *( double* ) obj );
    }
    if ( fullName == "System.Boolean" ) {
        return json( *( bool* ) obj );
    }

    // Handle Unity types
    if ( fullName == "UnityEngine.Vector3" ) {
        return SerializeVector3( obj );
    }
    if ( fullName == "UnityEngine.Quaternion" ) {
        return SerializeQuaternion( obj );
    }
    if ( fullName == "UnityEngine.Color" ) {
        return SerializeColor( obj );
    }

    // Handle Dictionary/List
    if ( fullName.find( "Dictionary" ) != std::string::npos ||
         fullName.find( "List" ) != std::string::npos ) {
        // For now, return empty - would need collection handling
        return json::object( );
    }

    // Handle complex objects
    json result = json::object( );

    Il2CppClass cls( klass );
    auto fields = cls.GetFields( );

    for ( const auto& f : fields ) {
        uint32_t flags;
        std::string fieldType;
        std::string fieldName;
        int32_t offset;
        std::tie( flags, fieldType, fieldName, offset ) = f;

        // Skip static fields
        if ( flags & 0x0010 ) continue;

        // Get field value
        void* fieldValuePtr = ( void* ) ( ( uintptr_t ) obj + offset );

        // Get field class to determine type
        // For now, add simple value
        result[fieldName] = nullptr; // Placeholder
    }

    return result;
}

void* RuntimeDumper::FindSingleton( const char* className, const char* namespaceName ) {
    __try {
        Log( "  Attempting to get domain..." );
        // Get domain
        void* domain = api::get_domain( );
        if ( !domain ) {
            Log( "  [WARN] Domain is null" );
            return nullptr;
        }

        Log( "  Getting assemblies..." );
        // Get assemblies
        size_t count = 0;
        void** assemblies = api::get_assemblies( domain, &count );
        if ( !assemblies ) {
            Log( "  [WARN] Assemblies is null" );
            return nullptr;
        }

        Log( "  Searching through " + std::to_string( count ) + " assemblies..." );

        // Search for class
        for ( size_t i = 0; i < count; ++i ) {
            void* assembly = assemblies[i];
            if ( !assembly ) continue;

            void* image = api::assembly_get_image( assembly );
            if ( !image ) continue;

            if ( !api::class_from_name ) {
                Log( "  [ERROR] class_from_name function not available!" );
                return nullptr;
            }

            void* klass = api::class_from_name( image, namespaceName, className );
            if ( !klass ) continue;

            Log( "  [OK] Found class!" );

            // Try to find Instance field
            if ( !api::class_get_field_from_name ) {
                Log( "  [ERROR] class_get_field_from_name not available!" );
                return nullptr;
            }

            void* instanceField = api::class_get_field_from_name( klass, "Instance" );
            if ( !instanceField ) {
                instanceField = api::class_get_field_from_name( klass, "instance" );
            }
            if ( !instanceField ) {
                instanceField = api::class_get_field_from_name( klass, "_instance" );
            }

            if ( instanceField ) {
                Log( "  [OK] Found instance field!" );

                if ( !api::field_static_get_value ) {
                    Log( "  [ERROR] field_static_get_value not available!" );
                    return nullptr;
                }

                void* staticValue = nullptr;
                api::field_static_get_value( instanceField, &staticValue );

                if ( staticValue ) {
                    Log( "  [OK] Got instance value!" );
                } else {
                    Log( "  [WARN] Instance value is null" );
                }

                return staticValue;
            } else {
                Log( "  [WARN] No instance field found (tried Instance, instance, _instance)" );
            }
        }

        Log( "  [WARN] Class not found in any assembly" );
        return nullptr;

    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        Log( "  [ERROR] Exception caught in FindSingleton!" );
        return nullptr;
    }
}

void RuntimeDumper::DumpConfigTable( const char* className, const char* namespaceName, const char* filename ) {
    __try {
        Log( "\n--- Searching for " + std::string( namespaceName ) + "." + className + " ---" );

        void* instance = FindSingleton( className, namespaceName );
        if ( !instance ) {
            Log( "[WARN] Could not find instance of " + std::string( className ) + " via singleton, scanning static fields..." );
            instance = ScanForStaticInstance( className, namespaceName );
        }

        if ( !instance ) {
            Log( "[WARN] Could not find instance of " + std::string( className ) );
            Log( "      This class might not exist, or might use a different access pattern\n" );
            return;
        }

        Log( "[OK] Found instance at: " + std::to_string( ( uintptr_t ) instance ) );

        json data = SerializeObjectDynamic( instance, 0 );

        std::string baseFolder = "c:\\Users\\fonta\\GIT\\IL2CPP-Dumper\\extracted_data\\";
        std::string outputPath = filename;
        std::replace( outputPath.begin( ), outputPath.end( ), '/', '\\' );

        size_t slashPos = outputPath.find_last_of( '\\' );
        if ( slashPos != std::string::npos ) {
            EnsureDirectory( baseFolder + outputPath.substr( 0, slashPos + 1 ) );
        } else {
            EnsureDirectory( baseFolder );
        }

        std::string fullPath = baseFolder + outputPath;
        std::ofstream out( fullPath );
        if ( out.is_open( ) ) {
            out << data.dump( 2 );
            out.close( );
            Log( "[OK] Saved -> " + fullPath + "\n" );
        } else {
            Log( "[ERROR] Failed to open " + fullPath + "\n" );
        }

    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        Log( "[ERROR] Exception in DumpConfigTable for " + std::string( className ) + "\n" );
    }
}

void* RuntimeDumper::ScanForStaticInstance( const char* className, const char* namespaceName ) {
    __try {
        Log( "  Scanning all static fields for " + std::string( namespaceName ) + "." + className + "..." );

        void* domain = api::get_domain( );
        if ( !domain ) return nullptr;

        size_t count = 0;
        void** assemblies = api::get_assemblies( domain, &count );
        if ( !assemblies ) return nullptr;

        // Search through all assemblies
        for ( size_t i = 0; i < count; ++i ) {
            void* assembly = assemblies[i];
            if ( !assembly ) continue;

            void* image = api::assembly_get_image( assembly );
            if ( !image ) continue;

            size_t classCount = api::image_get_class_count( image );

            // Search through all classes in this assembly
            for ( size_t j = 0; j < classCount; ++j ) {
                void* klass = api::image_get_class( image, j );
                if ( !klass ) continue;

                // Iterate through all fields in this class
                void* iter = nullptr;
                while ( void* field = api::class_get_fields( klass, &iter ) ) {
                    uint32_t flags = api::field_get_flags( field );

                    // Check if static field
                    if ( !( flags & 0x0010 ) ) continue;

                    // Get the field type
                    void* fieldType = api::field_get_type( field );
                    if ( !fieldType ) continue;

                    const char* fieldTypeName = api::type_get_name( fieldType );
                    if ( !fieldTypeName ) continue;

                    // Check if this field's type matches our target class
                    std::string typeNameStr( fieldTypeName );
                    std::string targetTypeName = std::string( namespaceName ) + "." + className;

                    if ( typeNameStr.find( targetTypeName ) != std::string::npos ) {
                        // Found a static field of the target type!
                        void* staticValue = nullptr;
                        api::field_static_get_value( field, &staticValue );

                        if ( staticValue ) {
                            const char* ownerClassName = api::class_get_name( klass );
                            const char* fieldName = api::field_get_name( field );
                            Log( "  [OK] Found " + targetTypeName + " in static field: " +
                                 std::string( ownerClassName ) + "." + fieldName );
                            return staticValue;
                        }
                    }
                }
            }
        }

        Log( "  [WARN] No static instance found for " + std::string( className ) );
        return nullptr;

    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        Log( "  [ERROR] Exception in ScanForStaticInstance!" );
        return nullptr;
    }
}

// Serialize a primitive value (int, float, string, bool)
json SerializePrimitive( void* obj, const char* typeName ) {
    if ( !obj || !typeName ) return nullptr;

    std::string type( typeName );

    if ( type.find( "Int32" ) != std::string::npos || type.find( "UInt32" ) != std::string::npos ) {
        return json( *( int32_t* ) obj );
    }
    if ( type.find( "Int64" ) != std::string::npos || type.find( "UInt64" ) != std::string::npos ) {
        return json( *( int64_t* ) obj );
    }
    if ( type.find( "Single" ) != std::string::npos ) {
        return json( *( float* ) obj );
    }
    if ( type.find( "Double" ) != std::string::npos ) {
        return json( *( double* ) obj );
    }
    if ( type.find( "Boolean" ) != std::string::npos ) {
        return json( *( bool* ) obj );
    }
    if ( type.find( "String" ) != std::string::npos ) {
        // IL2CPP strings are objects with a pointer to char data
        if ( !obj ) return json( "" );
        // String objects have length at offset 0x10 and chars at 0x14
        uint32_t length = *( uint32_t* ) ( ( uintptr_t ) obj + 0x10 );
        wchar_t* chars = ( wchar_t* ) ( ( uintptr_t ) obj + 0x14 );
        if ( length > 0 && chars ) {
            std::wstring wstr( chars, length );
            std::string str( wstr.begin( ), wstr.end( ) );
            return json( str );
        }
        return json( "" );
    }

    return nullptr;
}

// Serialize Unity Vector3
json SerializeVector3Field( void* obj, int32_t offset ) {
    if ( !obj ) return json::object( );
    float* vec = ( float* ) ( ( uintptr_t ) obj + offset );
    json result;
    result["x"] = vec[0];
    result["y"] = vec[1];
    result["z"] = vec[2];
    return result;
}

// Convert TriggerShape enum value to string
std::string TriggerShapeToString( int32_t value ) {
    switch ( value ) {
        case 0: return "None";
        case 1: return "Box";
        case 2: return "Sphere";
        default: return "Unknown";
    }
}

// Serialize TriggerShapeData struct
json SerializeTriggerShapeData( void* shapeDataPtr ) {
    json result;
    if ( !shapeDataPtr ) return result;

    // TriggerShapeData offsets (relative to the shape struct):
    // type (int32) at 0x10
    // position (Vector3) at 0x14
    // eulerAngles (Vector3) at 0x20
    // size (Vector3) at 0x2C
    // radius (float) at 0x38

    uintptr_t shapeAddr = ( uintptr_t ) shapeDataPtr;

    int32_t type = *( int32_t* ) ( shapeAddr + 0x10 );
    result["type"] = TriggerShapeToString( type );

    // Position
    float* position = ( float* ) ( shapeAddr + 0x14 );
    result["position"]["x"] = position[0];
    result["position"]["y"] = position[1];
    result["position"]["z"] = position[2];

    // EulerAngles
    float* eulerAngles = ( float* ) ( shapeAddr + 0x20 );
    result["eulerAngles"]["x"] = eulerAngles[0];
    result["eulerAngles"]["y"] = eulerAngles[1];
    result["eulerAngles"]["z"] = eulerAngles[2];

    // Size
    float* size = ( float* ) ( shapeAddr + 0x2C );
    result["size"]["x"] = size[0];
    result["size"]["y"] = size[1];
    result["size"]["z"] = size[2];

    // Radius
    result["radius"] = *( float* ) ( shapeAddr + 0x38 );

    return result;
}

// Serialize MissionAreaData object
json SerializeMissionAreaData( void* areaDataPtr ) {
    json result;
    if ( !areaDataPtr ) return result;

    // MissionAreaData offsets:
    // missionAreaId (String*) at 0x10
    // subDataParentId (UInt64) at 0x18
    // activeOnTravelLine (Boolean) at 0x20
    // shape (TriggerShapeData) at 0x24
    // trackingOffset (Vector3) at 0x50
    // snapToGround (Boolean) at 0x5C
    // needTrackingRoute (Boolean) at 0x5D
    // trackingRouteInfo (object*) at 0x60

    uintptr_t areaAddr = ( uintptr_t ) areaDataPtr;

    // missionAreaId
    void* missionAreaIdPtr = *( void** ) ( areaAddr + 0x10 );
    if ( missionAreaIdPtr ) {
        uint32_t length = *( uint32_t* ) ( ( uintptr_t ) missionAreaIdPtr + 0x10 );
        wchar_t* chars = ( wchar_t* ) ( ( uintptr_t ) missionAreaIdPtr + 0x14 );
        if ( length > 0 && chars ) {
            std::wstring wstr( chars, length );
            std::string str( wstr.begin( ), wstr.end( ) );
            result["missionAreaId"] = str;
        } else {
            result["missionAreaId"] = "";
        }
    } else {
        result["missionAreaId"] = "";
    }

    // subDataParentId
    result["subDataParentId"] = *( uint64_t* ) ( areaAddr + 0x18 );

    // activeOnTravelLine
    result["activeOnTravelLine"] = *( bool* ) ( areaAddr + 0x20 );

    // shape (inline struct at 0x24)
    result["shape"] = SerializeTriggerShapeData( ( void* ) ( areaAddr + 0x24 ) );

    // trackingOffset
    float* trackingOffset = ( float* ) ( areaAddr + 0x50 );
    result["trackingOffset"]["x"] = trackingOffset[0];
    result["trackingOffset"]["y"] = trackingOffset[1];
    result["trackingOffset"]["z"] = trackingOffset[2];

    // snapToGround
    result["snapToGround"] = *( bool* ) ( areaAddr + 0x5C );

    // needTrackingRoute
    result["needTrackingRoute"] = *( bool* ) ( areaAddr + 0x5D );

    // trackingRouteInfo
    void* trackingRouteInfoPtr = *( void** ) ( areaAddr + 0x60 );
    if ( trackingRouteInfoPtr ) {
        // TODO: Implement TrackingRouteInfo serialization
        result["trackingRouteInfo"] = json::object( );
    } else {
        result["trackingRouteInfo"] = nullptr;
    }

    return result;
}

json RuntimeDumper::SerializeMissionAreaTable( void* missionAreaTableObj ) {
    json result = json::object( );

    if ( !missionAreaTableObj ) return result;

    __try {
        // Get the MissionAreaTable class
        void* tableClass = api::object_get_class( missionAreaTableObj );
        if ( !tableClass ) return result;

        // Get the m_areas field (Dictionary<int, Dictionary<string, MissionAreaData>>)
        void* areasField = api::class_get_field_from_name( tableClass, "m_areas" );
        if ( !areasField ) {
            Log( "  [WARN] Could not find m_areas field" );
            return result;
        }

        // Get the dictionary object
        void* areasDict = api::field_get_value_object( areasField, missionAreaTableObj );
        if ( !areasDict ) {
            result["m_areas"] = json::object( );
            return result;
        }

        Log( "  Serializing m_areas dictionary..." );

        // Use dynamic serialization for the entire dictionary structure
        json serialized = SerializeDictionary( areasDict, 0 );
        result["m_areas"] = serialized;

    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        Log( "  [ERROR] Exception during serialization" );
        result["error"] = "Exception during serialization";
    }

    return result;
}

void RuntimeDumper::DumpGameplayConfigMissionAreaTable( ) {
    __try {
        Log( "\n--- Dumping MissionAreaTable ---" );

        // First, try to find DataManager
        void* dataManager = ScanForStaticInstance( "DataManager", "Beyond.Gameplay" );
        if ( !dataManager ) {
            Log( "[WARN] Could not find DataManager instance\n" );
            return;
        }

        Log( "[OK] Found DataManager at: " + std::to_string( ( uintptr_t ) dataManager ) );

        // Get the DataManager class
        void* dataManagerClass = api::object_get_class( dataManager );
        if ( !dataManagerClass ) {
            Log( "[ERROR] Could not get DataManager class\n" );
            return;
        }

        // Get the missionAreaTable field
        void* missionAreaTableField = api::class_get_field_from_name( dataManagerClass, "<missionAreaTable>k__BackingField" );
        if ( !missionAreaTableField ) {
            Log( "[WARN] Could not find missionAreaTable field\n" );
            return;
        }

        // Get the field value
        void* missionAreaTable = api::field_get_value_object( missionAreaTableField, dataManager );
        if ( !missionAreaTable ) {
            Log( "[WARN] missionAreaTable is null\n" );
            return;
        }

        Log( "[OK] Got MissionAreaTable instance" );

        // Serialize it
        json data = SerializeMissionAreaTable( missionAreaTable );

        // Save to the CommunityWebTemplate-compatible raw input layout
        std::string folder = "c:\\Users\\fonta\\GIT\\IL2CPP-Dumper\\extracted_data\\Json\\GameplayConfig\\";
        EnsureDirectory( folder );

        std::string fullPath = folder + "MissionAreaTable.json";
        std::ofstream out( fullPath );
        if ( out.is_open( ) ) {
            out << data.dump( 2 );
            out.close( );
            Log( "[OK] Saved -> " + fullPath + "\n" );
        } else {
            Log( "[ERROR] Failed to open " + fullPath + "\n" );
        }

    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        Log( "[ERROR] Exception in DumpGameplayConfigMissionAreaTable\n" );
    }
}

void RuntimeDumper::DumpGameplayConfigWorldEntityRegistry( ) {
    // WorldEntityRegistry is also likely accessed via a manager
    DumpConfigTable( "WorldEntityRegistry", "Beyond.Gameplay", "GameplayConfigWorldEntityRegistry.json" );
}

// Generic function to dump any DataManager table
void RuntimeDumper::DumpDataManagerTable( void* dataManager, const char* fieldName, const char* outputFilename ) {
    __try {
        Log( "\n--- Dumping " + std::string( outputFilename ) + " ---" );

        // Get DataManager class
        void* dataManagerClass = api::object_get_class( dataManager );
        if ( !dataManagerClass ) {
            Log( "[WARN] Could not get DataManager class" );
            return;
        }

        // Get the table field
        void* tableField = api::class_get_field_from_name( dataManagerClass, fieldName );
        if ( !tableField ) {
            Log( "[WARN] Could not find field: " + std::string( fieldName ) );
            return;
        }

        // Get the table object
        void* tableObj = api::field_get_value_object( tableField, dataManager );
        if ( !tableObj ) {
            Log( "[WARN] Table is null" );
            return;
        }

        Log( "[OK] Got table instance, serializing..." );

        // Serialize dynamically
        json data = SerializeObjectDynamic( tableObj, 0 );

        // Save to file
        std::string baseFolder = "c:\\Users\\fonta\\GIT\\IL2CPP-Dumper\\extracted_data\\Json\\";
        std::string outputPath = outputFilename;

        // Check if output path contains subdirectory (forward slash)
        size_t slashPos = outputPath.find( '/' );
        if ( slashPos != std::string::npos ) {
            // Extract subfolder and create it
            std::string subfolder = outputPath.substr( 0, slashPos );
            std::string subfolderPath = baseFolder + subfolder + "\\";
            EnsureDirectory( subfolderPath );

            // Convert forward slash to backslash for Windows
            outputPath[slashPos] = '\\';
        } else {
            EnsureDirectory( baseFolder );
        }

        std::string fullPath = baseFolder + outputPath;
        std::ofstream out( fullPath );
        if ( out.is_open( ) ) {
            out << data.dump( 2 );
            out.close( );
            Log( "[OK] Saved -> " + fullPath );
        } else {
            Log( "[ERROR] Failed to open " + fullPath );
        }

    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        Log( "[ERROR] Exception in DumpDataManagerTable" );
    }
}

// Streaming version - writes JSON incrementally to handle large files
void RuntimeDumper::DumpDataManagerTableStreaming( void* dataManager, const char* fieldName, const char* outputFilename ) {
    __try {
        Log( "\n--- Dumping (STREAMING) " + std::string( outputFilename ) + " ---" );

        // Get DataManager class
        void* dataManagerClass = api::object_get_class( dataManager );
        if ( !dataManagerClass ) {
            Log( "[WARN] Could not get DataManager class" );
            return;
        }

        // Get the table field
        void* tableField = api::class_get_field_from_name( dataManagerClass, fieldName );
        if ( !tableField ) {
            Log( "[WARN] Could not find field: " + std::string( fieldName ) );
            return;
        }

        // Get the table object
        void* tableObj = api::field_get_value_object( tableField, dataManager );
        if ( !tableObj ) {
            Log( "[WARN] Table is null" );
            return;
        }

        Log( "[OK] Got table instance, serializing with streaming..." );

        // Prepare output path
        std::string baseFolder = "c:\\Users\\fonta\\GIT\\IL2CPP-Dumper\\extracted_data\\Json\\";
        std::string outputPath = outputFilename;

        size_t slashPos = outputPath.find( '/' );
        if ( slashPos != std::string::npos ) {
            std::string subfolder = outputPath.substr( 0, slashPos );
            std::string subfolderPath = baseFolder + subfolder + "\\";
            EnsureDirectory( subfolderPath );
            outputPath[slashPos] = '\\';
        } else {
            EnsureDirectory( baseFolder );
        }

        std::string fullPath = baseFolder + outputPath;

        std::ofstream out( fullPath );
        if ( !out.is_open( ) ) {
            Log( "[ERROR] Failed to open " + fullPath );
            return;
        }

        // Write opening brace
        out << "{\n";
        bool firstField = true;
        int fieldsWritten = 0;

        // Get the object's class and iterate through fields
        void* klass = api::object_get_class( tableObj );
        if ( klass ) {
            void* iter = nullptr;
            while ( void* field = api::class_get_fields( klass, &iter ) ) {
                __try {
                    uint32_t flags = api::field_get_flags( field );
                    if ( flags & 0x0010 ) continue; // Skip static fields

                    const char* fieldName_c = api::field_get_name( field );
                    if ( !fieldName_c ) continue;

                    std::string fieldNameStr( fieldName_c );

                    // Skip backing fields
                    if ( fieldNameStr.find( "__BackingField" ) != std::string::npos ) {
                        size_t start = fieldNameStr.find( '<' ) + 1;
                        size_t end = fieldNameStr.find( '>' );
                        if ( start != std::string::npos && end != std::string::npos ) {
                            fieldNameStr = fieldNameStr.substr( start, end - start );
                        }
                    }

                    // Serialize this field with limited depth
                    void* fieldType = api::field_get_type( field );
                    json fieldValue = SerializeFieldValue( tableObj, field, fieldType, 0 );

                    if ( !fieldValue.is_null( ) ) {
                        if ( !firstField ) {
                            out << ",\n";
                        }
                        firstField = false;

                        out << "  \"" << fieldNameStr << "\": ";
                        out << fieldValue.dump( 2 );
                        fieldsWritten++;

                        // Log progress for large tables
                        if ( fieldsWritten % 100 == 0 ) {
                            Log( "[PROGRESS] Written " + std::to_string( fieldsWritten ) + " fields..." );
                            out.flush( );
                        }
                    }

                } __except( EXCEPTION_EXECUTE_HANDLER ) {
                    // Skip field on exception
                    continue;
                }
            }
        }

        out << "\n}\n";
        out.close( );

        Log( "[OK] Saved (streaming) -> " + fullPath + " (" + std::to_string( fieldsWritten ) + " fields)" );

    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        Log( "[ERROR] Exception in DumpDataManagerTableStreaming" );
    }
}

// Dump dictionary entries as individual files
void RuntimeDumper::DumpDictionaryAsFiles( void* dataManager, const char* fieldName, const char* folderName ) {
    __try {
        Log( "\n--- Dumping dictionary to folder: " + std::string( folderName ) + " ---" );

        // Get DataManager class
        void* dataManagerClass = api::object_get_class( dataManager );
        if ( !dataManagerClass ) {
            Log( "[WARN] Could not get DataManager class" );
            return;
        }

        // Get the table field
        void* tableField = api::class_get_field_from_name( dataManagerClass, fieldName );
        if ( !tableField ) {
            Log( "[WARN] Could not find field: " + std::string( fieldName ) );
            return;
        }

        // Get the table object
        void* tableObj = api::field_get_value_object( tableField, dataManager );
        if ( !tableObj ) {
            Log( "[WARN] Table is null" );
            return;
        }

        // Get the table class
        void* tableClass = api::object_get_class( tableObj );
        if ( !tableClass ) {
            Log( "[WARN] Could not get table class" );
            return;
        }

        // Check if the table object itself is a Dictionary (KVTable extends Dictionary)
        const char* className = api::class_get_name( tableClass );
        const char* classNamespace = api::class_get_namespace( tableClass );
        std::string fullClassName = std::string( classNamespace ? classNamespace : "" ) + "." + std::string( className ? className : "unknown" );

        void* dictObj = nullptr;
        bool isDictionary = fullClassName.find( "Dictionary" ) != std::string::npos || fullClassName.find( "KVTable" ) != std::string::npos;

        // Also check parent classes to see if this extends Dictionary
        if ( !isDictionary && api::class_get_parent ) {
            __try {
                void* parentClass = api::class_get_parent( tableClass );
                int depth = 0;
                while ( parentClass && depth < 5 ) {  // Max 5 levels of inheritance
                    __try {
                        const char* parentName = api::class_get_name( parentClass );
                        const char* parentNamespace = api::class_get_namespace( parentClass );
                        std::string parentFullName = std::string( parentNamespace ? parentNamespace : "" ) + "." + std::string( parentName ? parentName : "" );

                        if ( parentFullName.find( "Dictionary" ) != std::string::npos || parentFullName.find( "KVTable" ) != std::string::npos ) {
                            isDictionary = true;
                            break;
                        }

                        parentClass = api::class_get_parent( parentClass );
                        depth++;
                    } __except( EXCEPTION_EXECUTE_HANDLER ) {
                        break;
                    }
                }
            } __except( EXCEPTION_EXECUTE_HANDLER ) {
                // Ignore exceptions
            }
        }

        if ( isDictionary ) {
            dictObj = tableObj;  // The table itself is the dictionary
        }

        // Only search for dictionary field if table is not already a dictionary
        void* dictField = nullptr;
        if ( !dictObj ) {
            // Try to find a dictionary field (try common names first, then enumerate all)
            dictField = api::class_get_field_from_name( tableClass, "dataTable" );
            if ( !dictField ) dictField = api::class_get_field_from_name( tableClass, "m_data" );
            if ( !dictField ) dictField = api::class_get_field_from_name( tableClass, "m_table" );
            if ( !dictField ) dictField = api::class_get_field_from_name( tableClass, "m_dataTable" );
            if ( !dictField ) dictField = api::class_get_field_from_name( tableClass, "_dataTable" );

            // If still not found, enumerate all fields and find the first Dictionary field
            if ( !dictField ) {
                void* iter = nullptr;
                while ( void* field = api::class_get_fields( tableClass, &iter ) ) {
                    void* fieldType = api::field_get_type( field );
                    const char* typeName = fieldType ? api::type_get_name( fieldType ) : nullptr;

                    if ( typeName && std::string( typeName ).find( "Dictionary" ) != std::string::npos ) {
                        dictField = field;
                        break;
                    }
                }
            }
        }  // End of if ( !dictObj )

        // If dictionary not found in table, search directly in DataManager
        void* dictSourceObj = tableObj;
        if ( !dictObj && !dictField ) {
            // Try searching in DataManager for matching dictionary field
            void* iter2 = nullptr;
            while ( void* field = api::class_get_fields( dataManagerClass, &iter2 ) ) {
                const char* fName = api::field_get_name( field );
                void* fieldType = api::field_get_type( field );
                const char* typeName = fieldType ? api::type_get_name( fieldType ) : nullptr;

                if ( !fName || !typeName ) continue;

                std::string fieldNameStr = fName;
                std::string typeNameStr = typeName;

                // Check if field matches our search criteria
                bool nameMatch = fieldNameStr.find( "level" ) != std::string::npos ||
                                 fieldNameStr.find( "Level" ) != std::string::npos ||
                                 fieldNameStr.find( "map" ) != std::string::npos ||
                                 fieldNameStr.find( "Map" ) != std::string::npos ||
                                 fieldNameStr.find( "config" ) != std::string::npos ||
                                 fieldNameStr.find( "Config" ) != std::string::npos;
                bool typeMatch = typeNameStr.find( "Dictionary" ) != std::string::npos;

                if ( typeMatch && nameMatch ) {
                    dictField = field;
                    dictSourceObj = dataManager;
                    break;
                }
            }
        }

        // Only use fallback serialization if we don't have EITHER dictObj or dictField
        if ( !dictObj && !dictField ) {
            Log( "[WARN] Could not find dictionary anywhere" );
            Log( "[INFO] Attempting to serialize the table object itself as fallback..." );

            json tableData = SerializeObjectDynamic( tableObj, 0 );

            std::string folder = "c:\\Users\\fonta\\GIT\\IL2CPP-Dumper\\extracted_data\\Json\\";
            EnsureDirectory( folder );

            std::string fullPath = folder + std::string( folderName ) + "_TableObject.json";
            std::ofstream out( fullPath );
            if ( out.is_open( ) ) {
                out << tableData.dump( 2 );
                out.close( );
                Log( "[OK] Saved serialized table object -> " + fullPath );
            } else {
                Log( "[ERROR] Failed to open " + fullPath );
            }

            return;
        }

        // Get the dictionary object from field if we don't already have it
        if ( !dictObj && dictField ) {
            dictObj = api::field_get_value_object( dictField, dictSourceObj );
            if ( !dictObj ) {
                Log( "[WARN] Dictionary is null" );
                return;
            }
        }

        if ( !dictObj ) {
            Log( "[ERROR] Could not get dictionary object" );
            return;
        }

        void* dictClass = api::object_get_class( dictObj );
        if ( !dictClass ) return;

        // Get _count
        void* countField = api::class_get_field_from_name( dictClass, "_count" );
        if ( !countField ) return;

        int32_t offset = api::field_get_offset( countField );
        int32_t count = *( int32_t* ) ( ( uintptr_t ) dictObj + offset );

        if ( count == 0 ) {
            Log( "  [WARN] Dictionary is empty" );
            return;
        }

        // Get _entries
        void* entriesField = api::class_get_field_from_name( dictClass, "_entries" );
        if ( !entriesField ) return;

        offset = api::field_get_offset( entriesField );
        void* entriesArray = *( void** ) ( ( uintptr_t ) dictObj + offset );
        if ( !entriesArray ) return;

        // Create output folder (use extracted_data/Json structure)
        std::string folder = "c:\\Users\\fonta\\GIT\\IL2CPP-Dumper\\extracted_data\\Json\\" + std::string( folderName ) + "\\";
        EnsureDirectory( folder );

        int filesCreated = 0;

        // Iterate entries
        for ( int32_t i = 0; i < count; ++i ) {
            uintptr_t entryAddr = ( uintptr_t ) entriesArray + 0x20 + ( i * 24 );

            // Try to extract key as string
            std::string keyStr;
            uintptr_t keyAsPtr = *( uintptr_t* ) ( entryAddr + 8 );
            bool isPointer = ( keyAsPtr > 0x10000 && keyAsPtr < 0x7FFFFFFFFFFF );

            if ( isPointer ) {
                // Try as string key
                __try {
                    void* keyPtr = ( void* ) keyAsPtr;
                    void* keyClass = api::object_get_class( keyPtr );
                    if ( keyClass ) {
                        const char* keyClassName = api::class_get_name( keyClass );
                        if ( keyClassName && std::string( keyClassName ) == "String" ) {
                            uint32_t length = *( uint32_t* ) ( ( uintptr_t ) keyPtr + 0x10 );
                            wchar_t* chars = ( wchar_t* ) ( ( uintptr_t ) keyPtr + 0x14 );
                            if ( length > 0 && length < 10000 && chars ) {
                                std::wstring wstr( chars, length );
                                keyStr = std::string( wstr.begin( ), wstr.end( ) );
                            }
                        }
                    }
                } __except( EXCEPTION_EXECUTE_HANDLER ) {
                    // Skip this entry
                    continue;
                }
            }

            if ( keyStr.empty( ) ) continue;

            // Get value
            void* valuePtr = *( void** ) ( entryAddr + 16 );
            if ( !valuePtr ) continue;

            // Log before serialization to identify crashes
            Log( "  [DEBUG] Serializing entry: " + keyStr );

            // Serialize value with exception handling (each entry independently)
            json data;
            __try {
                data = SerializeObjectDynamic( valuePtr, 0 );
                Log( "  [OK] Serialized entry: " + keyStr );
            } __except( EXCEPTION_EXECUTE_HANDLER ) {
                Log( "  [ERROR] CRASH during serialization of entry '" + keyStr + "'" );
                Log( "  [ERROR] This entry caused an exception, investigating..." );
                continue;
            }

            if ( data.is_null( ) || data.empty( ) ) {
                Log( "  [WARN] Entry '" + keyStr + "' produced null/empty data, skipping..." );
                continue;
            }

            if ( std::string( folderName ) == "Interactive/InteractiveData" ) {
                if ( !data.contains( "id" ) ) data["id"] = keyStr;
                if ( !data.contains( "name" ) ) data["name"] = keyStr;
            }

            std::string outputKey = keyStr;
            if ( std::string( folderName ) == "Interactive/InteractiveData" ) {
                outputKey = "data_" + keyStr;
            }

            std::string filename = folder + outputKey + ".json";
            std::string tempFilename = filename + ".tmp";
            Log( "  [DEBUG] Writing file: " + filename );
            Log( "  [DEBUG] Preparing JSON dump for entry: " + keyStr );
            Log( "  [DEBUG] Entry JSON type: " + std::string( data.is_object( ) ? "object" : data.is_array( ) ? "array" : "other" ) );
            if ( data.is_object( ) ) {
                Log( "  [DEBUG] Entry top-level field count: " + std::to_string( data.size( ) ) );
            } else if ( data.is_array( ) ) {
                Log( "  [DEBUG] Entry top-level array size: " + std::to_string( data.size( ) ) );
            }

            bool dumpSuccess = false;
            std::string dumped = SafeDumpJSON( data, dumpSuccess );
            if ( !dumpSuccess ) {
                Log( "  [WARN] Failed to stringify entry '" + keyStr + "', skipping file write" );
                continue;
            }
            Log( "  [DEBUG] JSON dump complete for entry: " + keyStr + " (" + std::to_string( dumped.size( ) ) + " bytes)" );

            bool wroteFile = false;
            __try {
                Log( "  [DEBUG] Opening temp file: " + tempFilename );
                std::ofstream out( tempFilename, std::ios::binary | std::ios::trunc );
                if ( out.is_open( ) ) {
                    Log( "  [DEBUG] Temp file opened, writing bytes for entry: " + keyStr );
                    out.write( dumped.data( ), static_cast<std::streamsize>( dumped.size( ) ) );
                    out.flush( );
                    wroteFile = out.good( );
                    out.close( );
                    Log( "  [DEBUG] Temp file write finished for entry: " + keyStr );
                }
            } __except( EXCEPTION_EXECUTE_HANDLER ) {
                Log( "  [ERROR] SEH during temp file write: " + keyStr );
            }

            if ( !wroteFile ) {
                Log( "  [ERROR] Failed to write temp output file: " + tempFilename );
                __try {
                    std::remove( tempFilename.c_str( ) );
                } __except( EXCEPTION_EXECUTE_HANDLER ) {
                }
                continue;
            }

            __try {
                Log( "  [DEBUG] Removing previous output file if it exists: " + filename );
                std::remove( filename.c_str( ) );
            } __except( EXCEPTION_EXECUTE_HANDLER ) {
                Log( "  [WARN] SEH while removing previous output file: " + filename );
            }

            Log( "  [DEBUG] Renaming temp file into final output for entry: " + keyStr );
            if ( std::rename( tempFilename.c_str( ), filename.c_str( ) ) == 0 ) {
                filesCreated++;
                Log( "  [OK] Finalized file for entry: " + keyStr );
            } else {
                Log( "  [ERROR] Failed to rename temp output file: " + tempFilename );
                __try {
                    std::remove( tempFilename.c_str( ) );
                } __except( EXCEPTION_EXECUTE_HANDLER ) {
                }
            }
        }

        Log( "  [OK] Created " + std::to_string( filesCreated ) + " files in " + folderName );

    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        Log( "[ERROR] Exception in DumpDictionaryAsFiles" );
    }
}

// Helper: Safely dump JSON with SEH to catch crashes
static std::string SafeDumpJSON(const json& j, bool& success) {
    success = false;
    std::string result;

    __try {
        result = j.dump(-1);  // Most compact format, no formatting at all
        success = true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        // Crash occurred, return empty value based on type
        if (j.is_array()) {
            result = "[]";
        } else if (j.is_object()) {
            result = "{}";
        } else {
            result = "null";
        }
    }

    return result;
}

// Helper: Safely write a sub-file (uses SEH exception handling)
static bool SafeWriteSubFile( const std::string& filename, const std::string& subName, const json& subData, std::function<void(std::string)> logFunc ) {
    __try {
        logFunc( "    [DEBUG] Writing sub-file: " + subName );

        __try {
            std::ofstream subOut( filename );
            if ( subOut.is_open( ) ) {
                // Use SafeDumpJSON to handle crashes
                bool success = false;
                std::string dumped = SafeDumpJSON( subData, success );
                if ( success ) {
                    subOut << dumped;
                    subOut.close( );
                    logFunc( "    [OK] Wrote sub-file: " + subName );
                    return true;
                } else {
                    logFunc( "  [WARN] Failed to dump sub-file: " + subName );
                    return false;
                }
            }
        } __except( EXCEPTION_EXECUTE_HANDLER ) {
            logFunc( "  [ERROR] SEH exception dumping sub-file: " + subName );
            return false;
        }
    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        logFunc( "  [ERROR] SEH exception writing sub-file: " + subName );
        return false;
    }

    return false;
}

// Helper: Split entities by category and write main + sub-files
void RuntimeDumper::SplitAndWriteLevelFiles( const std::string& levelId, const std::string& folder, const json& fullData ) {
    try {
        Log( "  Splitting " + levelId + " into main + sub-files..." );
        Log( "    [DEBUG] Creating entity field list" );

        // Entity array field names
        const std::vector<std::string> entityFields = {
            "enemies", "interactives", "npcs", "spawners", "airWalls",
            "patrols", "enemyPatrol", "charPatrol", "npcPatrol"
        };

        Log( "    [DEBUG] Initializing data structures" );
        // Accumulate entities by category
        std::map<std::string, json> subFiles; // category -> JSON data

        // Build mainData by copying non-entity fields carefully
        json mainData = json::object();
        Log( "    [DEBUG] Copying non-entity fields from fullData" );

        for (auto it = fullData.begin(); it != fullData.end(); ++it) {
            try {
                // Skip entity fields - we'll add filtered versions later
                if (std::find(entityFields.begin(), entityFields.end(), it.key()) == entityFields.end()) {
                    Log( "    [DEBUG] Copying field: " + it.key() );
                    mainData[it.key()] = it.value();
                }
            } catch (const std::exception& e) {
                Log( "  [WARN] Exception copying field " + it.key() + ": " + std::string(e.what()) );
            } catch (...) {
                Log( "  [WARN] Unknown exception copying field " + it.key() );
            }
        }
        Log( "    [DEBUG] Finished copying non-entity fields" );

        Log( "    [DEBUG] Starting entity field iteration" );
        // Process each entity field
        for ( const std::string& fieldName : entityFields ) {
            try {
                Log( "    [DEBUG] Processing field: " + fieldName );
                // Check if field exists and is array
                auto it = fullData.find( fieldName );
                if ( it == fullData.end( ) || !it->is_array( ) ) {
                    Log( "    [DEBUG] Field " + fieldName + " not found or not array, skipping" );
                    continue;
                }

                json mainEntities = json::array( );
                const json& entities = *it;
                Log( "    [DEBUG] Field " + fieldName + " has " + std::to_string( entities.size( ) ) + " entities" );

                for ( const auto& entity : entities ) {
                    try {
                        // Check if entity has levelLogicId OR belongLevelScriptId
                        int64_t logicId = 0;
                        auto logicIdIt = entity.find( "levelLogicId" );
                        if ( logicIdIt != entity.end( ) && logicIdIt->is_number_integer( ) ) {
                            logicId = logicIdIt->get<int64_t>( );
                        } else {
                            auto belongIdIt = entity.find( "belongLevelScriptId" );
                            if ( belongIdIt != entity.end( ) && belongIdIt->is_number_integer( ) ) {
                                logicId = belongIdIt->get<int64_t>( );
                            }
                        }

                        if ( logicId > 0 ) {
                            std::string category = GetCategoryFromLogicId( logicId );
                            std::string filename = GetFilenameForCategory( category );

                            if ( !filename.empty( ) ) {
                                // Initialize sub-file if needed
                                if ( subFiles.find( filename ) == subFiles.end( ) ) {
                                    int levelNum = 0;
                                    auto levelNumIt = fullData.find( "levelIdNum" );
                                    if ( levelNumIt != fullData.end( ) && levelNumIt->is_number( ) ) {
                                        levelNum = levelNumIt->get<int>( );
                                    }

                                    subFiles[filename] = {
                                        {"sceneId", levelId},
                                        {"levelIdNum", levelNum},
                                        {"specificData", nullptr},
                                        {"blackbox", nullptr},
                                        {"guideHints", json::array( )},
                                        {"enemies", json::array( )},
                                        {"interactives", json::array( )},
                                        {"interactiveLockData", json::array( )},
                                        {"factoryRegions", json::array( )},
                                        {"factoryMines", json::array( )},
                                        {"npcs", json::array( )},
                                        {"npcClusters", json::array( )},
                                        {"levelScripts", nullptr},
                                        {"levelScriptDataPathDict", json::object( )},
                                        {"levelScriptBriefDataDict", json::object( )},
                                        {"patrols", json::array( )},
                                        {"enemyPatrol", json::array( )},
                                        {"charPatrol", json::array( )},
                                        {"npcPatrol", json::array( )},
                                        {"npcAttractPointData", json::array( )},
                                        {"missionAreas", json::array( )},
                                        {"taskAreas", json::array( )},
                                        {"enemyGroup", json::array( )},
                                        {"npcGroup", json::array( )},
                                        {"cameraPoses", json::array( )},
                                        {"splines", json::array( )},
                                        {"airWalls", json::array( )},
                                        {"environmentVolumes", json::array( )},
                                        {"spawners", json::array( )},
                                        {"waterVolumes", json::array( )},
                                        {"levelUIs", json::array( )},
                                        {"safeZone", json::object( )},
                                        {"factoryPredefineData", json::object( )},
                                        {"predefinedParams", json::array( )},
                                        {"functionArea", json::object( )},
                                        {"doodadGroup", json::array( )},
                                        {"mapVolumeDatas", json::array( )},
                                        {"dynamicOccludeAreas", json::array( )}
                                    };
                                }

                                subFiles[filename][fieldName].push_back( entity );
                                continue; // Don't add to main file
                            }
                        }
                    } catch ( ... ) {
                        // If processing this entity fails, add it to main file
                    }

                    // No category or unknown category -> add to main file
                    mainEntities.push_back( entity );
                }

                // Update main file with entities that don't have categories
                mainData[fieldName] = mainEntities;

            } catch ( const std::exception& e ) {
                Log( "  [WARN] Exception processing field " + fieldName + ": " + std::string(e.what( )) );
            } catch ( ... ) {
                Log( "  [WARN] Unknown exception processing field " + fieldName );
            }
        }

        Log( "    [DEBUG] Entity field iteration complete, writing files" );
        // Write main file incrementally to avoid memory issues
        try {
            Log( "    [DEBUG] Writing main file incrementally" );
            std::string mainFilename = folder + levelId + "_lv_data.json";
            std::ofstream mainOut( mainFilename );
            if ( mainOut.is_open( ) ) {
                mainOut << "{\n";
                bool firstField = true;

                // Write all fields from fullData
                for (auto it = fullData.begin(); it != fullData.end(); ++it) {
                    try {
                        Log( "    [DEBUG] Writing field: " + it.key() );
                        if (!firstField) mainOut << ",\n";
                        firstField = false;

                        // Write field name
                        mainOut << "  \"" << it.key() << "\": ";

                        // For entity fields, use filtered arrays; for others, use original
                        if (std::find(entityFields.begin(), entityFields.end(), it.key()) != entityFields.end()) {
                            Log( "    [DEBUG] Dumping entity field: " + it.key() );
                            auto arrayIt = mainData.find(it.key());
                            if (arrayIt != mainData.end() && arrayIt->is_array()) {
                                // Manually write array elements one-by-one to avoid crash
                                mainOut << "[";
                                bool firstElement = true;
                                int elementCount = 0;
                                for (const auto& element : *arrayIt) {
                                    if (!firstElement) mainOut << ",";
                                    firstElement = false;

                                    bool success = false;
                                    std::string elementStr = SafeDumpJSON(element, success);
                                    if (success) {
                                        mainOut << elementStr;
                                        elementCount++;
                                    } else {
                                        Log( "  [WARN] Skipped corrupted element in " + it.key() );
                                    }
                                }
                                mainOut << "]";
                                Log( "    [DEBUG] Wrote " + std::to_string(elementCount) + " elements for: " + it.key() );
                            } else {
                                mainOut << "[]";
                            }
                        } else {
                            // npcAttractPointData causes unrecoverable crash - write as [] (matches reference)
                            if (it.key() == "npcAttractPointData") {
                                Log( "    [INFO] Writing npcAttractPointData as [] (prevents crash)" );
                                mainOut << "[]";
                            } else {
                                Log( "    [DEBUG] Dumping non-entity field: " + it.key() );
                                bool success = false;
                                std::string dumped = SafeDumpJSON(it.value(), success);
                                if (!success) {
                                    Log( "  [WARN] SEH exception dumping field " + it.key() + ", using empty value" );
                                }
                                Log( "    [DEBUG] Writing dumped content for: " + it.key() );
                                mainOut << dumped;
                                Log( "    [DEBUG] Successfully wrote: " + it.key() );
                            }
                        }
                    } catch (const std::exception& e) {
                        Log( "  [WARN] Exception writing field " + it.key() + ": " + std::string(e.what()) );
                        mainOut << "null";
                    } catch (...) {
                        Log( "  [WARN] Unknown exception writing field " + it.key() );
                        mainOut << "null";
                    }
                }

                mainOut << "\n}\n";
                mainOut.close( );
                Log( "    [OK] Wrote main file: " + levelId + "_lv_data.json" );
            } else {
                Log( "    [ERROR] Failed to open main file for writing" );
            }
        } catch ( const std::exception& e ) {
            Log( "  [ERROR] Exception writing main file: " + std::string(e.what( )) );
        }

        // Write sub-files
        int subFileCount = 0;
        for ( const auto& [subName, subData] : subFiles ) {
            std::string subFilename = folder + levelId + "_lv_data_sub_" + subName + ".json";
            if ( SafeWriteSubFile( subFilename, subName, subData, []( std::string msg ) { Log( msg ); } ) ) {
                subFileCount++;
            }
        }

        Log( "    [OK] Wrote " + std::to_string( subFileCount ) + " sub-files" );

    } catch ( const std::exception& e ) {
        Log( "  [ERROR] Exception in SplitAndWriteLevelFiles: " + std::string(e.what( )) );
    } catch ( ... ) {
        Log( "  [ERROR] Unknown exception in SplitAndWriteLevelFiles" );
    }
}

// Dump all level data (per-level extraction with sub-files)
void RuntimeDumper::DumpAllLevelData( void* dataManager ) {
    __try {
        Log( "\n--- Extracting all LevelData ---" );

        // Get DataManager class
        void* dataManagerClass = api::object_get_class( dataManager );
        if ( !dataManagerClass ) {
            Log( "[WARN] Could not get DataManager class" );
            return;
        }

        // Try to get level data cache (private field at offset 0xB0)
        void* levelDataCacheField = api::class_get_field_from_name( dataManagerClass, "m_levelDataCache" );

        if ( !levelDataCacheField ) {
            Log( "[WARN] Could not find m_levelDataCache field in DataManager" );
            return;
        }

        // Get the cache dictionary object
        void* cacheDict = api::field_get_value_object( levelDataCacheField, dataManager );
        if ( !cacheDict ) {
            Log( "[WARN] LevelData cache is null (no levels loaded yet)" );
            return;
        }

        Log( "[OK] Got LevelData cache dictionary" );

        // m_levelDataCache is already a Dictionary, use it directly
        void* dictObj = cacheDict;

        void* dictClass = api::object_get_class( dictObj );
        if ( !dictClass ) {
            Log( "[WARN] Could not get dictionary class" );
            return;
        }

        // Get dictionary count
        void* countField = api::class_get_field_from_name( dictClass, "_count" );
        if ( !countField ) return;

        int32_t offset = api::field_get_offset( countField );
        int32_t count = *( int32_t* ) ( ( uintptr_t ) dictObj + offset );

        if ( count == 0 ) return;

        Log( "[DEBUG] LevelData cache has " + std::to_string( count ) + " entries" );

        // Get _entries
        void* entriesField = api::class_get_field_from_name( dictClass, "_entries" );
        if ( !entriesField ) return;

        offset = api::field_get_offset( entriesField );
        void* entriesArray = *( void** ) ( ( uintptr_t ) dictObj + offset );
        if ( !entriesArray ) return;

        int filesCreated = 0;

        // Iterate entries
        for ( int32_t i = 0; i < count; ++i ) {
            uintptr_t entryAddr = ( uintptr_t ) entriesArray + 0x20 + ( i * 24 );

            // Extract key as string
            std::string keyStr;
            uintptr_t keyAsPtr = *( uintptr_t* ) ( entryAddr + 8 );
            bool isPointer = ( keyAsPtr > 0x10000 && keyAsPtr < 0x7FFFFFFFFFFF );

            if ( isPointer ) {
                __try {
                    void* keyPtr = ( void* ) keyAsPtr;
                    void* keyClass = api::object_get_class( keyPtr );
                    if ( keyClass ) {
                        const char* keyClassName = api::class_get_name( keyClass );
                        if ( keyClassName && std::string( keyClassName ) == "String" ) {
                            uint32_t length = *( uint32_t* ) ( ( uintptr_t ) keyPtr + 0x10 );
                            wchar_t* chars = ( wchar_t* ) ( ( uintptr_t ) keyPtr + 0x14 );
                            if ( length > 0 && length < 10000 && chars ) {
                                std::wstring wstr( chars, length );
                                keyStr = std::string( wstr.begin( ), wstr.end( ) );
                            }
                        }
                    }
                } __except( EXCEPTION_EXECUTE_HANDLER ) {
                    continue;
                }
            }

            if ( keyStr.empty( ) ) continue;

            // Skip all blackbox_ test/debug levels
            if ( keyStr.find( "blackbox_" ) != std::string::npos ) {
                Log( "  [SKIP] Ignoring blackbox level: " + keyStr );
                continue;
            }

            // Extract ALL maps (no longer filtering to specific maps)

            // Get value (the level data object)
            void* valuePtr = *( void** ) ( entryAddr + 16 );
            if ( !valuePtr ) continue;

            __try {
                Log( "  Processing level: " + keyStr );

                // Create folder for this level
                std::string folder = "c:\\Users\\fonta\\GIT\\IL2CPP-Dumper\\extracted_data\\Json\\LevelData\\" + keyStr + "\\";
                EnsureDirectory( folder );

                // Get LevelData class
                void* levelDataClass = api::object_get_class( valuePtr );
                if ( !levelDataClass ) {
                    Log( "    [ERROR] Could not get class for: " + keyStr );
                    continue;
                }

                // Extract ONLY fields needed for map generator (matching reference project structure)
                const char* fieldNames[] = {
                    // ENABLED: Essential fields for map POI generation
                    "sceneId",        // Level identifier
                    "levelIdNum",     // Level number
                    "interactives",   // POI data (campfires, teleports, resource nodes, etc.) - THIS IS THE MAIN DATA WE NEED
                    "enemies",        // Enemy spawn locations - FIELD FILTERED (only essential data, no heavy nested objects)
                    "npcs",           // NPC entities - FIELD FILTERED (only essential data)
                    "factoryRegions", // Factory zones - FIELD FILTERED (only essential data)
                    "guideHints",     // Tutorial/guide markers
                    "specificData",   // Level-specific configuration

                    // COMMENTED OUT: Not used by map generator or causing slowness (uncomment if needed later)
                    // "blackbox",       // Special level data - removed per user request
                    // ENEMIES AND NPCS NOW ENABLED WITH FIELD FILTERING - keeping only essential fields
                    // "npcClusters",                // NPC grouping - not needed
                    // "levelScripts",               // Mission scripts - not POI data
                    // "patrols",                    // Patrol paths - not needed
                    // "enemyPatrol",                // Enemy patrol data - not needed
                    // "charPatrol",                 // Character patrol - not needed
                    // "npcPatrol",                  // NPC patrol - not needed
                    // "spawners",                   // Entity spawners - not needed
                    // "missionAreas",               // Mission zones - not needed
                    // "taskAreas",                  // Task zones - not needed
                    // "waterVolumes",               // Water collision - not needed
                    // "airWalls",                   // Invisible walls - not needed
                    // "splines",                    // Path curves - not needed
                    // "cameraPoses",                // Camera positions - not needed
                    // "levelUIs",                   // UI elements - not needed
                    // "environmentVolumes",         // Environment zones - not needed
                    // "aiTransData",                // AI navigation - not needed
                    // "autoSpawnedInteractives",    // Auto-spawned entities - not needed
                    // "doodadGroup",                // Decorative objects - not needed
                    // "dynamicOccludeAreas",        // Occlusion culling - not needed
                    // "enemyGroup",                 // Enemy grouping - not needed
                    // "erosionSludgeDatas",         // Terrain erosion - not needed
                    // "factoryMines",               // Factory system - not needed
                    // "factoryPredefineData",       // Factory presets - not needed
                    // "factoryRegions",             // Factory zones - not needed
                    // "functionArea",               // Function zones - not needed
                    // "interactiveLockData",        // Lock conditions - not needed (already in interactives.progressLockCondition)
                    // "levelScriptBriefDataDict",   // Script briefs - not needed
                    // "levelScriptDataPathDict",    // Script paths - not needed
                    // "levelWideConfigs",           // Level config - not needed
                    // "mapVolumeDatas",             // Map volumes - not needed
                    // "npcAttractPointData",        // NPC attraction points - not needed
                    // "npcGroup",                   // NPC grouping - not needed
                    // "predefinedParams",           // Predefined parameters - not needed
                    // "safeZone",                   // Safe zones - not needed
                    // "sludgeDatas",                // Sludge system - not needed
                    // "worldWayPointData"           // Waypoints - not needed
                };

                json fullData = json::object();
                int fieldCount = 0;
                static int totalFieldCount = 0;  // Counter across all levels for anti-cheat

                for ( const char* fieldName : fieldNames ) {
                    __try {
                        void* field = api::class_get_field_from_name( levelDataClass, fieldName );
                        if ( !field ) {
                            continue;
                        }

                        void* fieldType = api::field_get_type( field );
                        if ( !fieldType ) {
                            continue;
                        }

                        Log( "    Serializing field: " + std::string( fieldName ) );

                        __try {
                            g_visitedObjects.clear();
                            json fieldValue = SerializeFieldValue( valuePtr, field, fieldType, 0 );
                            fullData[fieldName] = fieldValue;
                            fieldCount++;
                            totalFieldCount++;
                            Log( "      [OK] Serialized field: " + std::string( fieldName ) );

                            if ( totalFieldCount % 10 == 0 ) {
                                Log( "    [ANTI-CHEAT+GC] Pausing 200ms after " + std::to_string( totalFieldCount ) + " fields..." );
                                Sleep( 200 );
                            }
                        } __except( EXCEPTION_EXECUTE_HANDLER ) {
                            Log( "    [ERROR] Exception serializing field: " + std::string( fieldName ) );
                            fullData[fieldName] = nullptr;
                        }

                    } __except( EXCEPTION_EXECUTE_HANDLER ) {
                        Log( "    [WARN] Failed to access field: " + std::string( fieldName ) );
                    }
                }

                if ( fieldCount > 0 ) {
                    SplitAndWriteLevelFiles( keyStr, folder, fullData );
                    filesCreated++;
                    Log( "    [OK] Serialized " + std::to_string( fieldCount ) + " fields and split LevelData for: " + keyStr );
                } else {
                    Log( "    [WARN] No fields extracted for: " + keyStr );
                }

            } __except( EXCEPTION_EXECUTE_HANDLER ) {
                Log( "    [ERROR] Exception while processing level: " + keyStr );
                continue;
            }
        }

        Log( "  [OK] Created " + std::to_string( filesCreated ) + " LevelData directories" );

    } __except( EXCEPTION_EXECUTE_HANDLER ) {
        Log( "[ERROR] Exception in DumpAllLevelData" );
    }
}

void RuntimeDumper::DumpAllGameData( ) {
    Log( "\n=== Starting Runtime Data Dump ===" );

    // Check if IL2CPP API is initialized
    if ( !api::initialized ) {
        Log( "[ERROR] IL2CPP API not initialized! Cannot dump runtime data." );
        Log( "        Make sure the game is fully loaded before pressing DELETE." );
        return;
    }

    Log( "[OK] IL2CPP API is initialized" );

    // Verify critical function pointers
    if ( !api::get_domain ) {
        Log( "[ERROR] get_domain function is null!" );
        return;
    }
    if ( !api::class_from_name ) {
        Log( "[ERROR] class_from_name function is null!" );
        return;
    }

    Log( "[OK] Critical API functions available" );

    // Find DataManager
    void* dataManager = ScanForStaticInstance( "DataManager", "Beyond.Gameplay" );
    if ( !dataManager ) {
        Log( "[ERROR] Could not find DataManager instance" );
        return;
    }

    Log( "[OK] Found DataManager at: " + std::to_string( ( uintptr_t ) dataManager ) );

    Log( "\n=== Extracting TableCfg ===" );
    DumpConfigTable( "TextTable", "Beyond.Cfg.Tables", "TableCfg/TextTable.json" );
    DumpConfigTable( "DoodadGeneralTable", "Beyond.Cfg.Tables", "TableCfg/DoodadGeneralTable.json" );
    DumpConfigTable( "EnemyTemplateDisplayInfoTable", "Beyond.Cfg.Tables", "TableCfg/EnemyTemplateDisplayInfoTable.json" );
    DumpConfigTable( "CollectionTable", "Beyond.Cfg.Tables", "TableCfg/CollectionTable.json" );
    DumpConfigTable( "ItemTable", "Beyond.Cfg.Tables", "TableCfg/ItemTable.json" );
    DumpConfigTable( "RewardTable", "Beyond.Cfg.Tables", "TableCfg/RewardTable.json" );
    DumpConfigTable( "DungeonSeriesTable", "Beyond.Cfg.Tables", "TableCfg/DungeonSeriesTable.json" );
    DumpConfigTable( "MapMarkTempTable", "Beyond.Cfg.Tables", "TableCfg/MapMarkTempTable.json" );
    DumpConfigTable( "MapMarkInsTable", "Beyond.Cfg.Tables", "TableCfg/MapMarkInsTable.json" );
    DumpConfigTable( "MapMarkTypeTable", "Beyond.Cfg.Tables", "TableCfg/MapMarkTypeTable.json" );
    DumpConfigTable( "TrackMapPointTable", "Beyond.Cfg.Tables", "TableCfg/TrackMapPointTable.json" );
    DumpConfigTable( "WorldEnergyPointTable", "Beyond.Cfg.Tables", "TableCfg/WorldEnergyPointTable.json" );
    DumpConfigTable( "MapIdTable", "Beyond.Cfg.Tables", "TableCfg/MapIdTable.json" );
    DumpConfigTable( "ShopGroupTable", "Beyond.Cfg.Tables", "TableCfg/ShopGroupTable.json" );
    DumpConfigTable( "ShopTable", "Beyond.Cfg.Tables", "TableCfg/ShopTable.json" );
    DumpConfigTable( "ShopGoodsTable", "Beyond.Cfg.Tables", "TableCfg/ShopGoodsTable.json" );
    DumpConfigTable( "WeekraidItemDomainTable", "Beyond.Cfg.Tables", "TableCfg/WeekraidItemDomainTable.json" );
    DumpConfigTable( "PrtsRecord", "Beyond.Cfg.Tables", "TableCfg/PrtsRecord.json" );
    DumpConfigTable( "PrtsAllItem", "Beyond.Cfg.Tables", "TableCfg/PrtsAllItem.json" );
    DumpConfigTable( "ReadingPopUpTable", "Beyond.Cfg.Tables", "TableCfg/ReadingPopUpTable.json" );
    DumpConfigTable( "RichContentTable", "Beyond.Cfg.Tables", "TableCfg/RichContentTable.json" );
    DumpConfigTable( "I18nTextTable_EN", "Beyond.Cfg.Tables", "TableCfg/I18nTextTable_EN.json" );

    // Restore the broader runtime extraction set in addition to map data.
    Log( "\n=== Extracting Single-File Config Tables ===" );
    DumpGameplayConfigMissionAreaTable( );
    DumpDataManagerTableStreaming( dataManager, "<worldEntityRegistry>k__BackingField", "GameplayConfig/WorldEntityRegistry.json" );
    DumpDataManagerTableStreaming( dataManager, "<npcProxyTable>k__BackingField", "GameplayConfig/NpcProxyTable.json" );
    DumpDataManagerTableStreaming( dataManager, "<npcRuntimeProxyDataTable>k__BackingField", "GameplayConfig/NpcProxyTable.json" );
    DumpDataManagerTableStreaming( dataManager, "<scriptTaskExtraInfoTable>k__BackingField", "GameplayConfig/ScriptTaskExtraInfoTable.json" );
    DumpDataManagerTableStreaming( dataManager, "<levelScriptTaskExtraInfoTable>k__BackingField", "GameplayConfig/ScriptTaskExtraInfoTable.json" );
    DumpDataManagerTableStreaming( dataManager, "<subGameInstanceDataTable>k__BackingField", "GameplayConfig/SubGameInstanceDataTable.json" );
    DumpDataManagerTableStreaming( dataManager, "<subGameInstDataTable>k__BackingField", "GameplayConfig/SubGameInstanceDataTable.json" );
    DumpDataManagerTableStreaming( dataManager, "spaceshipCabinData", "GameplayConfig/SpaceshipCabinData.json" );

    Log( "\n=== Extracting Dictionary-Based Tables ===" );
    DumpDictionaryAsFiles( dataManager, "<levelConfigTable>k__BackingField", "LevelConfig" );
    DumpDictionaryAsFiles( dataManager, "<mapConfigTable>k__BackingField", "MapConfig" );
    DumpDictionaryAsFiles( dataManager, "<levelMountPointTable>k__BackingField", "LevelMountPoint" );
    // The map generate/optimize pipeline does not consume these heavy runtime tables.
    // They are disabled here because MissionRuntimeAsset repeatedly crashes the process
    // by walking deep runtime graphs before the required map data extraction can finish.
    // DumpDictionaryAsFiles( dataManager, "<missionRuntimeAssetTable>k__BackingField", "MissionRuntimeAsset" );
    // DumpDictionaryAsFiles( dataManager, "<spawnerConfigTable>k__BackingField", "SpawnerConfig" );
    // DumpDictionaryAsFiles( dataManager, "<blockDataTable>k__BackingField", "BlockData" );
    // DumpDictionaryAsFiles( dataManager, "<chessboardDataTable>k__BackingField", "ChessboardData" );
    // DumpDictionaryAsFiles( dataManager, "<gameModeTable>k__BackingField", "GameMode" );

    Log( "\n=== Extracting LevelData ===" );
    DumpAllLevelData( dataManager );

    Log( "\n=== Extracting Interactive Data ===" );
    DumpDictionaryAsFiles( dataManager, "interactiveTemplateDict", "Interactive/InteractiveData" );

    Log( "\n=== Extracting ModelViewStateController Data ===" );
    DumpDictionaryAsFiles( dataManager, "<modelViewStateControllersDataTable>k__BackingField", "Interactive/ModelViewStateControllerData" );

    Log( "\n=== Runtime Data Dump Complete ===" );
}

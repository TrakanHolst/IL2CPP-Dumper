#include "../include/il2cpp_api.hxx"
#include "../include/utils.hxx"
#include <windows.h>

namespace api {

    bool initialized = false;

    // function pointers
    get_domain_t get_domain = nullptr;
    get_assemblies_t get_assemblies = nullptr;
    assembly_get_image_t assembly_get_image = nullptr;
    image_get_name_t image_get_name = nullptr;

    image_get_class_count_t image_get_class_count = nullptr;
    image_get_class_t image_get_class = nullptr;

    class_get_name_t class_get_name = nullptr;
    class_get_namespace_t class_get_namespace = nullptr;
    class_get_flags_t class_get_flags = nullptr;
    class_get_parent_t class_get_parent = nullptr;
    class_is_valuetype_t class_is_valuetype = nullptr;
    class_is_enum_t class_is_enum = nullptr;
    class_is_interface_t class_is_interface = nullptr;
    class_get_interfaces_t class_get_interfaces = nullptr;
    class_get_element_class_t class_get_element_class = nullptr;
    class_get_instance_size_t class_get_instance_size = nullptr;

    class_num_fields_t class_num_fields = nullptr;
    class_get_fields_t class_get_fields = nullptr;
    field_get_name_t field_get_name = nullptr;
    field_get_type_t field_get_type = nullptr;
    field_get_flags_t field_get_flags = nullptr;
    field_get_offset_t field_get_offset = nullptr;

    class_get_methods_t class_get_methods = nullptr;
    method_get_name_t method_get_name = nullptr;
    method_get_flags_t method_get_flags = nullptr;
    method_get_param_count_t method_get_param_count = nullptr;
    method_get_param_t method_get_param = nullptr;
    method_get_param_name_t method_get_param_name = nullptr;
    method_get_return_type_t method_get_return_type = nullptr;

    type_get_name_t type_get_name = nullptr;
    class_get_type_token_t class_get_type_token = nullptr;

    class_from_name_t class_from_name = nullptr;
    class_get_field_from_name_t class_get_field_from_name = nullptr;
    field_static_get_value_t field_static_get_value = nullptr;
    object_get_class_t object_get_class = nullptr;
    field_get_value_object_t field_get_value_object = nullptr;


    void init( ) {
        if ( initialized ) {
            return;
        }

        HMODULE gameAsm = GetModuleHandleA( "GameAssembly.dll" );
        if ( !gameAsm ) {
            Log( "[ERROR] GameAssembly.dll not found" );
            return;
        }

        // Core functions - fail early if missing
        get_domain = ( get_domain_t ) GetProcAddress( gameAsm, "il2cpp_domain_get" );
        get_assemblies = ( get_assemblies_t ) GetProcAddress( gameAsm, "il2cpp_domain_get_assemblies" );
        assembly_get_image = ( assembly_get_image_t ) GetProcAddress( gameAsm, "il2cpp_assembly_get_image" );
        image_get_name = ( image_get_name_t ) GetProcAddress( gameAsm, "il2cpp_image_get_name" );

        // class / image enumeration
        image_get_class_count = ( image_get_class_count_t ) GetProcAddress( gameAsm, "il2cpp_image_get_class_count" );
        image_get_class = ( image_get_class_t ) GetProcAddress( gameAsm, "il2cpp_image_get_class" );

        // class reflection
        class_get_name = ( class_get_name_t ) GetProcAddress( gameAsm, "il2cpp_class_get_name" );
        class_get_namespace = ( class_get_namespace_t ) GetProcAddress( gameAsm, "il2cpp_class_get_namespace" );
        class_get_flags = ( class_get_flags_t ) GetProcAddress( gameAsm, "il2cpp_class_get_flags" );
        class_get_parent = ( class_get_parent_t ) GetProcAddress( gameAsm, "il2cpp_class_get_parent" );

        class_is_valuetype = ( class_is_valuetype_t ) GetProcAddress( gameAsm, "il2cpp_class_is_valuetype" );
        class_is_enum = ( class_is_enum_t ) GetProcAddress( gameAsm, "il2cpp_class_is_enum" );
        class_is_interface = ( class_is_interface_t ) GetProcAddress( gameAsm, "il2cpp_class_is_interface" );
        class_get_interfaces = ( class_get_interfaces_t ) GetProcAddress( gameAsm, "il2cpp_class_get_interfaces" );
        class_get_element_class = ( class_get_element_class_t ) GetProcAddress( gameAsm, "il2cpp_class_get_element_class" );
        class_get_instance_size = ( class_get_instance_size_t ) GetProcAddress( gameAsm, "il2cpp_class_get_instance_size" );

        // fields
        class_num_fields = ( class_num_fields_t ) GetProcAddress( gameAsm, "il2cpp_class_num_fields" );
        class_get_fields = ( class_get_fields_t ) GetProcAddress( gameAsm, "il2cpp_class_get_fields" );
        field_get_name = ( field_get_name_t ) GetProcAddress( gameAsm, "il2cpp_field_get_name" );
        field_get_type = ( field_get_type_t ) GetProcAddress( gameAsm, "il2cpp_field_get_type" );
        field_get_flags = ( field_get_flags_t ) GetProcAddress( gameAsm, "il2cpp_field_get_flags" );
        field_get_offset = ( field_get_offset_t ) GetProcAddress( gameAsm, "il2cpp_field_get_offset" );

        // methods
        class_get_methods = ( class_get_methods_t ) GetProcAddress( gameAsm, "il2cpp_class_get_methods" );
        method_get_name = ( method_get_name_t ) GetProcAddress( gameAsm, "il2cpp_method_get_name" );
        method_get_flags = ( method_get_flags_t ) GetProcAddress( gameAsm, "il2cpp_method_get_flags" );
        method_get_param_count = ( method_get_param_count_t ) GetProcAddress( gameAsm, "il2cpp_method_get_param_count" );
        method_get_param = ( method_get_param_t ) GetProcAddress( gameAsm, "il2cpp_method_get_param" );
        method_get_param_name = ( method_get_param_name_t ) GetProcAddress( gameAsm, "il2cpp_method_get_param_name" );
        method_get_return_type = ( method_get_return_type_t ) GetProcAddress( gameAsm, "il2cpp_method_get_return_type" );

        type_get_name = ( type_get_name_t ) GetProcAddress( gameAsm, "il2cpp_type_get_name" );
        class_get_type_token = ( class_get_type_token_t ) GetProcAddress( gameAsm, "il2cpp_class_get_type_token" );

        // Runtime data access
        class_from_name = ( class_from_name_t ) GetProcAddress( gameAsm, "il2cpp_class_from_name" );
        class_get_field_from_name = ( class_get_field_from_name_t ) GetProcAddress( gameAsm, "il2cpp_class_get_field_from_name" );
        field_static_get_value = ( field_static_get_value_t ) GetProcAddress( gameAsm, "il2cpp_field_static_get_value" );
        object_get_class = ( object_get_class_t ) GetProcAddress( gameAsm, "il2cpp_object_get_class" );
        field_get_value_object = ( field_get_value_object_t ) GetProcAddress( gameAsm, "il2cpp_field_get_value_object" );


        if ( !get_domain || !get_assemblies || !assembly_get_image || !image_get_name ) {
            Log( "[ERROR] Failed to resolve core IL2CPP functions" );
            return;
        }

        initialized = true;
        Log( "[OK] IL2CPP API initialized" );
    }

}
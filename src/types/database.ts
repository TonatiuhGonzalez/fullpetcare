export type Json =
  string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      appointment_products: {
        Row: {
          appointment_id: string
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          is_billable: boolean
          name_snapshot: string
          product_id: string
          quantity: number
          sold_unit: string
          tax_rate_bp: number
          tenant_id: string
          unit_price_cents: number
          units_per_package_snapshot: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          appointment_id: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          id?: string
          is_billable?: boolean
          name_snapshot: string
          product_id: string
          quantity: number
          sold_unit?: string
          tax_rate_bp: number
          tenant_id: string
          unit_price_cents: number
          units_per_package_snapshot?: number
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          is_billable?: boolean
          name_snapshot?: string
          product_id?: string
          quantity?: number
          sold_unit?: string
          tax_rate_bp?: number
          tenant_id?: string
          unit_price_cents?: number
          units_per_package_snapshot?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_products_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "appointment_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_services: {
        Row: {
          appointment_id: string
          created_at: string
          deleted_at: string | null
          duration_minutes_snapshot: number
          id: string
          name_snapshot: string
          quantity: number
          service_id: string
          tenant_id: string
          unit_price_cents: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          appointment_id: string
          created_at?: string
          deleted_at?: string | null
          duration_minutes_snapshot: number
          id?: string
          name_snapshot: string
          quantity?: number
          service_id: string
          tenant_id: string
          unit_price_cents: number
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          deleted_at?: string | null
          duration_minutes_snapshot?: number
          id?: string
          name_snapshot?: string
          quantity?: number
          service_id?: string
          tenant_id?: string
          unit_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_services_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_surgery_lines: {
        Row: {
          appointment_id: string
          appointment_product_id: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          description: string
          id: string
          is_billable: boolean
          kind: Database["public"]["Enums"]["surgery_item_kind"]
          package_id: string | null
          product_id: string | null
          quantity: number
          sat_product_code: string
          sat_unit_code: string
          sold_unit: string
          tax_rate_bp: number
          tenant_id: string
          unit_price_cents: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          appointment_id: string
          appointment_product_id?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          description: string
          id?: string
          is_billable?: boolean
          kind: Database["public"]["Enums"]["surgery_item_kind"]
          package_id?: string | null
          product_id?: string | null
          quantity: number
          sat_product_code?: string
          sat_unit_code?: string
          sold_unit?: string
          tax_rate_bp: number
          tenant_id: string
          unit_price_cents: number
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          appointment_product_id?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          description?: string
          id?: string
          is_billable?: boolean
          kind?: Database["public"]["Enums"]["surgery_item_kind"]
          package_id?: string | null
          product_id?: string | null
          quantity?: number
          sat_product_code?: string
          sat_unit_code?: string
          sold_unit?: string
          tax_rate_bp?: number
          tenant_id?: string
          unit_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_surgery_lines_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_surgery_lines_appointment_product_id_fkey"
            columns: ["appointment_product_id"]
            isOneToOne: false
            referencedRelation: "appointment_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_surgery_lines_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "surgery_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_surgery_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "appointment_surgery_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_surgery_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string
          customer_id: string
          deleted_at: string | null
          employee_user_id: string
          ends_at: string
          id: string
          is_urgent: boolean
          is_walk_in: boolean
          kind: Database["public"]["Enums"]["service_kind"]
          notes: string | null
          pet_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          branch_id: string
          created_at?: string
          created_by: string
          customer_id: string
          deleted_at?: string | null
          employee_user_id: string
          ends_at: string
          id?: string
          is_urgent?: boolean
          is_walk_in?: boolean
          kind: Database["public"]["Enums"]["service_kind"]
          notes?: string | null
          pet_id: string
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string
          customer_id?: string
          deleted_at?: string | null
          employee_user_id?: string
          ends_at?: string
          id?: string
          is_urgent?: boolean
          is_walk_in?: boolean
          kind?: Database["public"]["Enums"]["service_kind"]
          notes?: string | null
          pet_id?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "appointments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_user_id: string | null
          changed_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string
          table_name: string
          tenant_id: string
        }
        ComputedFields: never
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_user_id?: string | null
          changed_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id: string
          table_name: string
          tenant_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          actor_user_id?: string | null
          changed_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string
          table_name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          opening_hours: NonNullable<Json>
          phone: string | null
          postal_code: string | null
          tenant_id: string
          timezone: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          address?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          opening_hours?: NonNullable<Json>
          phone?: string | null
          postal_code?: string | null
          tenant_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          opening_hours?: NonNullable<Json>
          phone?: string | null
          postal_code?: string | null
          tenant_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      breeds: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          search_aliases: string[]
          species_id: string
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          search_aliases?: string[]
          species_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          search_aliases?: string[]
          species_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "breeds_species_fkey"
            columns: ["tenant_id", "species_id"]
            isOneToOne: false
            referencedRelation: "species"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "breeds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cancellation_reasons: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["cancellation_reason_kind"]
          label: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["cancellation_reason_kind"]
          label: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["cancellation_reason_kind"]
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      cash_movements: {
        Row: {
          amount_cents: number
          branch_id: string
          cash_session_id: string
          created_at: string
          created_by: string
          id: string
          movement_type: Database["public"]["Enums"]["cash_movement_type"]
          reason: string
          tenant_id: string
        }
        ComputedFields: never
        Insert: {
          amount_cents: number
          branch_id: string
          cash_session_id: string
          created_at?: string
          created_by: string
          id?: string
          movement_type: Database["public"]["Enums"]["cash_movement_type"]
          reason: string
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          branch_id?: string
          cash_session_id?: string
          created_at?: string
          created_by?: string
          id?: string
          movement_type?: Database["public"]["Enums"]["cash_movement_type"]
          reason?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "cash_movements_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          branch_id: string
          closed_at: string | null
          closed_by: string | null
          closing_note: string | null
          counted_cents: number | null
          created_at: string
          deleted_at: string | null
          difference_cents: number | null
          expected_cents: number | null
          id: string
          opened_at: string
          opened_by: string
          opening_float_cents: number
          opening_note: string | null
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          branch_id: string
          closed_at?: string | null
          closed_by?: string | null
          closing_note?: string | null
          counted_cents?: number | null
          created_at?: string
          deleted_at?: string | null
          difference_cents?: number | null
          expected_cents?: number | null
          id?: string
          opened_at?: string
          opened_by: string
          opening_float_cents: number
          opening_note?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          closed_at?: string | null
          closed_by?: string | null
          closing_note?: string | null
          counted_cents?: number | null
          created_at?: string
          deleted_at?: string | null
          difference_cents?: number | null
          expected_cents?: number | null
          id?: string
          opened_at?: string
          opened_by?: string
          opening_float_cents?: number
          opening_note?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "cash_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_accounts: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          linked_at: string
          linked_via_link_id: string | null
          tenant_id: string
          unlinked_at: string | null
          unlinked_by: string | null
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          linked_at?: string
          linked_via_link_id?: string | null
          tenant_id: string
          unlinked_at?: string | null
          unlinked_by?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          linked_at?: string
          linked_via_link_id?: string | null
          tenant_id?: string
          unlinked_at?: string | null
          unlinked_by?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_accounts_customer_fkey"
            columns: ["tenant_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "customer_accounts_linked_via_link_id_fkey"
            columns: ["linked_via_link_id"]
            isOneToOne: false
            referencedRelation: "share_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          cfdi_use: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          first_name: string
          id: string
          last_name: string
          legal_name: string | null
          notes: string | null
          phone: string | null
          postal_code: string | null
          requires_invoice: boolean
          rfc: string | null
          tax_regime_code: string | null
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          cfdi_use?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_name: string
          id?: string
          last_name: string
          legal_name?: string | null
          notes?: string | null
          phone?: string | null
          postal_code?: string | null
          requires_invoice?: boolean
          rfc?: string | null
          tax_regime_code?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cfdi_use?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string
          legal_name?: string | null
          notes?: string | null
          phone?: string | null
          postal_code?: string | null
          requires_invoice?: boolean
          rfc?: string | null
          tax_regime_code?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_details: {
        Row: {
          birth_date: string | null
          created_at: string
          curp: string | null
          deleted_at: string | null
          id: string
          membership_id: string
          professional_license: string | null
          rfc: string | null
          tenant_id: string
          updated_at: string
          voter_id_number: string | null
        }
        ComputedFields: never
        Insert: {
          birth_date?: string | null
          created_at?: string
          curp?: string | null
          deleted_at?: string | null
          id?: string
          membership_id: string
          professional_license?: string | null
          rfc?: string | null
          tenant_id: string
          updated_at?: string
          voter_id_number?: string | null
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          curp?: string | null
          deleted_at?: string | null
          id?: string
          membership_id?: string
          professional_license?: string | null
          rfc?: string | null
          tenant_id?: string
          updated_at?: string
          voter_id_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_details_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: true
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_details_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_documents: {
        Row: {
          created_at: string
          deleted_at: string | null
          document_type: Database["public"]["Enums"]["employee_document_type"]
          id: string
          membership_id: string
          storage_path: string
          tenant_id: string
          updated_at: string
          uploaded_at: string
          uploaded_by: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          document_type: Database["public"]["Enums"]["employee_document_type"]
          id?: string
          membership_id: string
          storage_path: string
          tenant_id: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          document_type?: Database["public"]["Enums"]["employee_document_type"]
          id?: string
          membership_id?: string
          storage_path?: string
          tenant_id?: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_documents_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "families_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      family_members: {
        Row: {
          created_at: string
          customer_id: string
          deleted_at: string | null
          family_id: string
          id: string
          is_holder: boolean
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          customer_id: string
          deleted_at?: string | null
          family_id: string
          id?: string
          is_holder?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          deleted_at?: string | null
          family_id?: string
          id?: string
          is_holder?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_members_customer_fkey"
            columns: ["tenant_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "family_members_family_fkey"
            columns: ["tenant_id", "family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "family_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_reports: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          message: string
          screenshot_path: string | null
          tenant_id: string
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          message: string
          screenshot_path?: string | null
          tenant_id: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          message?: string
          screenshot_path?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      grooming_records: {
        Row: {
          appointment_id: string
          behavior_notes: string | null
          blade_used: string | null
          condition_observations: string | null
          created_at: string
          cut_style: string | null
          groomer_notes: string | null
          id: string
          pet_id: string
          shampoo_used: string | null
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          appointment_id: string
          behavior_notes?: string | null
          blade_used?: string | null
          condition_observations?: string | null
          created_at?: string
          cut_style?: string | null
          groomer_notes?: string | null
          id?: string
          pet_id: string
          shampoo_used?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          behavior_notes?: string | null
          blade_used?: string | null
          condition_observations?: string | null
          created_at?: string
          cut_style?: string | null
          groomer_notes?: string | null
          id?: string
          pet_id?: string
          shampoo_used?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grooming_records_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grooming_records_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grooming_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hospital_medications: {
        Row: {
          administered_at: string
          administered_by: string
          billed_sale_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          is_billable: boolean
          name_snapshot: string
          product_id: string
          quantity: number
          sold_unit: string
          stay_id: string
          tax_rate_bp: number
          tenant_id: string
          unit_price_cents: number
          units_per_package_snapshot: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          administered_at?: string
          administered_by: string
          billed_sale_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_billable?: boolean
          name_snapshot: string
          product_id: string
          quantity: number
          sold_unit?: string
          stay_id: string
          tax_rate_bp: number
          tenant_id: string
          unit_price_cents: number
          units_per_package_snapshot?: number
          updated_at?: string
        }
        Update: {
          administered_at?: string
          administered_by?: string
          billed_sale_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_billable?: boolean
          name_snapshot?: string
          product_id?: string
          quantity?: number
          sold_unit?: string
          stay_id?: string
          tax_rate_bp?: number
          tenant_id?: string
          unit_price_cents?: number
          units_per_package_snapshot?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hospital_medications_billed_sale_id_fkey"
            columns: ["billed_sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hospital_medications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "hospital_medications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hospital_medications_stay_id_fkey"
            columns: ["stay_id"]
            isOneToOne: false
            referencedRelation: "hospital_stays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hospital_medications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hospital_notes: {
        Row: {
          author_user_id: string
          content: string | null
          created_at: string
          elimination: string | null
          heart_rate_bpm: number | null
          id: string
          mood: string | null
          mucous_color: string | null
          noted_at: string
          stay_id: string
          temperature_deci_c: number | null
          tenant_id: string
          weight_grams: number | null
        }
        ComputedFields: never
        Insert: {
          author_user_id: string
          content?: string | null
          created_at?: string
          elimination?: string | null
          heart_rate_bpm?: number | null
          id?: string
          mood?: string | null
          mucous_color?: string | null
          noted_at?: string
          stay_id: string
          temperature_deci_c?: number | null
          tenant_id: string
          weight_grams?: number | null
        }
        Update: {
          author_user_id?: string
          content?: string | null
          created_at?: string
          elimination?: string | null
          heart_rate_bpm?: number | null
          id?: string
          mood?: string | null
          mucous_color?: string | null
          noted_at?: string
          stay_id?: string
          temperature_deci_c?: number | null
          tenant_id?: string
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "hospital_notes_stay_id_fkey"
            columns: ["stay_id"]
            isOneToOne: false
            referencedRelation: "hospital_stays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hospital_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hospital_settings: {
        Row: {
          created_at: string
          day_rule: string
          default_daily_rate_cents: number | null
          default_stay_rate_cents: number | null
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          day_rule?: string
          default_daily_rate_cents?: number | null
          default_stay_rate_cents?: number | null
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_rule?: string
          default_daily_rate_cents?: number | null
          default_stay_rate_cents?: number | null
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hospital_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hospital_spaces: {
        Row: {
          branch_id: string
          created_at: string
          daily_rate_cents: number | null
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          space_type: string | null
          stay_rate_cents: number | null
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          branch_id: string
          created_at?: string
          daily_rate_cents?: number | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          space_type?: string | null
          stay_rate_cents?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          daily_rate_cents?: number | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          space_type?: string | null
          stay_rate_cents?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hospital_spaces_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hospital_spaces_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "hospital_spaces_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hospital_stays: {
        Row: {
          admitted_at: string
          admitted_by: string
          billed_sale_id: string | null
          branch_id: string
          created_at: string
          customer_id: string | null
          day_rule: string
          discharged_at: string | null
          discharged_by: string | null
          id: string
          pet_id: string
          rate_cents: number
          rate_mode: string
          reason: string | null
          space_id: string
          tax_rate_bp: number
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          admitted_at?: string
          admitted_by: string
          billed_sale_id?: string | null
          branch_id: string
          created_at?: string
          customer_id?: string | null
          day_rule: string
          discharged_at?: string | null
          discharged_by?: string | null
          id?: string
          pet_id: string
          rate_cents: number
          rate_mode: string
          reason?: string | null
          space_id: string
          tax_rate_bp?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          admitted_at?: string
          admitted_by?: string
          billed_sale_id?: string | null
          branch_id?: string
          created_at?: string
          customer_id?: string | null
          day_rule?: string
          discharged_at?: string | null
          discharged_by?: string | null
          id?: string
          pet_id?: string
          rate_cents?: number
          rate_mode?: string
          reason?: string | null
          space_id?: string
          tax_rate_bp?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hospital_stays_billed_sale_id_fkey"
            columns: ["billed_sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hospital_stays_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hospital_stays_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "hospital_stays_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hospital_stays_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hospital_stays_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "hospital_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hospital_stays_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_requests: {
        Row: {
          cancellation_reason_code: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cfdi_use: string
          created_at: string
          deleted_at: string | null
          error_message: string | null
          fiscal_uuid: string | null
          id: string
          legal_name: string
          pac_invoice_id: string | null
          payment_form_code: string
          payment_method_code: string
          pdf_path: string | null
          postal_code: string
          rfc: string
          sale_id: string
          stamped_at: string | null
          status: string
          tax_regime_code: string
          tenant_id: string
          updated_at: string
          xml_path: string | null
        }
        ComputedFields: never
        Insert: {
          cancellation_reason_code?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cfdi_use: string
          created_at?: string
          deleted_at?: string | null
          error_message?: string | null
          fiscal_uuid?: string | null
          id?: string
          legal_name: string
          pac_invoice_id?: string | null
          payment_form_code: string
          payment_method_code: string
          pdf_path?: string | null
          postal_code: string
          rfc: string
          sale_id: string
          stamped_at?: string | null
          status?: string
          tax_regime_code: string
          tenant_id: string
          updated_at?: string
          xml_path?: string | null
        }
        Update: {
          cancellation_reason_code?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cfdi_use?: string
          created_at?: string
          deleted_at?: string | null
          error_message?: string | null
          fiscal_uuid?: string | null
          id?: string
          legal_name?: string
          pac_invoice_id?: string | null
          payment_form_code?: string
          payment_method_code?: string
          pdf_path?: string | null
          postal_code?: string
          rfc?: string
          sale_id?: string
          stamped_at?: string | null
          status?: string
          tax_regime_code?: string
          tenant_id?: string
          updated_at?: string
          xml_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_requests_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_records: {
        Row: {
          appointment_id: string
          created_at: string
          diagnosis: string | null
          examination: string | null
          history: string | null
          id: string
          indications: string | null
          next_visit_date: string | null
          pet_id: string
          reason: string | null
          temperature_deci_c: number | null
          tenant_id: string
          treatment: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          appointment_id: string
          created_at?: string
          diagnosis?: string | null
          examination?: string | null
          history?: string | null
          id?: string
          indications?: string | null
          next_visit_date?: string | null
          pet_id: string
          reason?: string | null
          temperature_deci_c?: number | null
          tenant_id: string
          treatment?: string | null
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          diagnosis?: string | null
          examination?: string | null
          history?: string | null
          id?: string
          indications?: string | null
          next_visit_date?: string | null
          pet_id?: string
          reason?: string | null
          temperature_deci_c?: number | null
          tenant_id?: string
          treatment?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medical_records_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_records_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_branches: {
        Row: {
          branch_id: string
          created_at: string
          deleted_at: string | null
          id: string
          membership_id: string
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          branch_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          membership_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          membership_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "membership_branches_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["member_role"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          role: Database["public"]["Enums"]["member_role"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["member_role"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          deleted_at: string | null
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          paid_at: string
          payment_form_code: string | null
          reference: string | null
          sale_id: string
          status: Database["public"]["Enums"]["payment_status"]
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          amount_cents: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          paid_at?: string
          payment_form_code?: string | null
          reference?: string | null
          sale_id: string
          status: Database["public"]["Enums"]["payment_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          paid_at?: string
          payment_form_code?: string | null
          reference?: string | null
          sale_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_ownerships: {
        Row: {
          created_at: string
          customer_id: string
          ended_at: string | null
          id: string
          pet_id: string
          started_at: string
          tenant_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          customer_id: string
          ended_at?: string | null
          id?: string
          pet_id: string
          started_at?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          ended_at?: string | null
          id?: string
          pet_id?: string
          started_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pet_ownerships_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_ownerships_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_ownerships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_weights: {
        Row: {
          appointment_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          measured_at: string
          pet_id: string
          tenant_id: string
          updated_at: string
          weight_grams: number
        }
        ComputedFields: never
        Insert: {
          appointment_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          measured_at?: string
          pet_id: string
          tenant_id: string
          updated_at?: string
          weight_grams: number
        }
        Update: {
          appointment_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          measured_at?: string
          pet_id?: string
          tenant_id?: string
          updated_at?: string
          weight_grams?: number
        }
        Relationships: [
          {
            foreignKeyName: "pet_weights_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_weights_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_weights_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pets: {
        Row: {
          birth_date: string | null
          birth_date_is_estimated: boolean
          breed: string | null
          breed_id: string | null
          created_at: string
          customer_id: string
          deleted_at: string | null
          grooming_notes: string | null
          id: string
          is_sterilized: boolean
          medical_alerts: string | null
          name: string
          photo_path: string | null
          sex: Database["public"]["Enums"]["pet_sex"] | null
          species: Database["public"]["Enums"]["pet_species"]
          species_id: string | null
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          birth_date?: string | null
          birth_date_is_estimated?: boolean
          breed?: string | null
          breed_id?: string | null
          created_at?: string
          customer_id: string
          deleted_at?: string | null
          grooming_notes?: string | null
          id?: string
          is_sterilized?: boolean
          medical_alerts?: string | null
          name: string
          photo_path?: string | null
          sex?: Database["public"]["Enums"]["pet_sex"] | null
          species: Database["public"]["Enums"]["pet_species"]
          species_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          birth_date_is_estimated?: boolean
          breed?: string | null
          breed_id?: string | null
          created_at?: string
          customer_id?: string
          deleted_at?: string | null
          grooming_notes?: string | null
          id?: string
          is_sterilized?: boolean
          medical_alerts?: string | null
          name?: string
          photo_path?: string | null
          sex?: Database["public"]["Enums"]["pet_sex"] | null
          species?: Database["public"]["Enums"]["pet_species"]
          species_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pets_breed_fkey"
            columns: ["tenant_id", "species_id", "breed_id"]
            isOneToOne: false
            referencedRelation: "breeds"
            referencedColumns: ["tenant_id", "species_id", "id"]
          },
          {
            foreignKeyName: "pets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pets_species_fkey"
            columns: ["tenant_id", "species_id"]
            isOneToOne: false
            referencedRelation: "species"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "pets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_user_id: string | null
          changed_at: string
          event: string | null
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string
          table_name: string
          tenant_id: string | null
        }
        ComputedFields: never
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_user_id?: string | null
          changed_at?: string
          event?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id: string
          table_name: string
          tenant_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          actor_user_id?: string | null
          changed_at?: string
          event?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string
          table_name?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prescription_items: {
        Row: {
          created_at: string
          deleted_at: string | null
          dose: string | null
          duration: string | null
          frequency: string | null
          id: string
          medication_name: string
          position: number
          prescription_id: string
          product_id: string | null
          review_dismissed_at: string | null
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          dose?: string | null
          duration?: string | null
          frequency?: string | null
          id?: string
          medication_name: string
          position?: number
          prescription_id: string
          product_id?: string | null
          review_dismissed_at?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          dose?: string | null
          duration?: string | null
          frequency?: string | null
          id?: string
          medication_name?: string
          position?: number
          prescription_id?: string
          product_id?: string | null
          review_dismissed_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescription_items_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "prescription_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          appointment_id: string
          branch_id: string
          created_at: string
          folio: number
          id: string
          issued_at: string
          issued_by_user_id: string
          issuer_license_snapshot: string
          issuer_name_snapshot: string
          pet_id: string
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          appointment_id: string
          branch_id: string
          created_at?: string
          folio: number
          id?: string
          issued_at?: string
          issued_by_user_id: string
          issuer_license_snapshot: string
          issuer_name_snapshot: string
          pet_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          branch_id?: string
          created_at?: string
          folio?: number
          id?: string
          issued_at?: string
          issued_by_user_id?: string
          issuer_license_snapshot?: string
          issuer_name_snapshot?: string
          pet_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "prescriptions_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          deleted_at: string | null
          icon: string
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          icon: string
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_suppliers: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          product_id: string
          supplier_id: string
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          product_id: string
          supplier_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          product_id?: string
          supplier_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_suppliers_product_fkey"
            columns: ["tenant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["tenant_id", "product_id"]
          },
          {
            foreignKeyName: "product_suppliers_product_fkey"
            columns: ["tenant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "product_suppliers_supplier_fkey"
            columns: ["tenant_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "product_suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category_id: string | null
          cost_cents: number | null
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          min_stock: number
          name: string
          package_name: string | null
          price_cents: number
          sat_product_code: string
          sat_unit_code: string
          sku: string | null
          tax_rate_bp: number
          tenant_id: string
          unit_name: string | null
          unit_price_cents: number | null
          unit_sat_code: string | null
          units_per_package: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          category_id?: string | null
          cost_cents?: number | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          min_stock?: number
          name: string
          package_name?: string | null
          price_cents: number
          sat_product_code?: string
          sat_unit_code?: string
          sku?: string | null
          tax_rate_bp?: number
          tenant_id: string
          unit_name?: string | null
          unit_price_cents?: number | null
          unit_sat_code?: string | null
          units_per_package?: number
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          cost_cents?: number | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          min_stock?: number
          name?: string
          package_name?: string | null
          price_cents?: number
          sat_product_code?: string
          sat_unit_code?: string
          sku?: string | null
          tax_rate_bp?: number
          tenant_id?: string
          unit_name?: string | null
          unit_price_cents?: number | null
          unit_sat_code?: string | null
          units_per_package?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_fkey"
            columns: ["tenant_id", "category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          deleted_at: string | null
          full_name: string
          id: string
          must_change_password: boolean
          phone: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          avatar_path?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name: string
          id: string
          must_change_password?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name?: string
          id?: string
          must_change_password?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          can_edit: boolean
          can_view: boolean
          created_at: string
          id: string
          module: Database["public"]["Enums"]["permission_module"]
          role: Database["public"]["Enums"]["member_role"]
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          module: Database["public"]["Enums"]["permission_module"]
          role: Database["public"]["Enums"]["member_role"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          module?: Database["public"]["Enums"]["permission_module"]
          role?: Database["public"]["Enums"]["member_role"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          appointment_id: string | null
          appointment_product_id: string | null
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          item_type: Database["public"]["Enums"]["sale_item_type"]
          line_total_cents: number
          product_id: string | null
          quantity: number
          sale_id: string
          sat_product_code_snapshot: string | null
          sat_unit_code_snapshot: string | null
          service_id: string | null
          sold_unit: string
          tax_cents: number
          tax_rate_bp: number
          tenant_id: string
          unit_price_cents: number
          units_per_package_snapshot: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          appointment_id?: string | null
          appointment_product_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description: string
          id?: string
          item_type?: Database["public"]["Enums"]["sale_item_type"]
          line_total_cents: number
          product_id?: string | null
          quantity?: number
          sale_id: string
          sat_product_code_snapshot?: string | null
          sat_unit_code_snapshot?: string | null
          service_id?: string | null
          sold_unit?: string
          tax_cents: number
          tax_rate_bp: number
          tenant_id: string
          unit_price_cents: number
          units_per_package_snapshot?: number
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          appointment_product_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          item_type?: Database["public"]["Enums"]["sale_item_type"]
          line_total_cents?: number
          product_id?: string | null
          quantity?: number
          sale_id?: string
          sat_product_code_snapshot?: string | null
          sat_unit_code_snapshot?: string | null
          service_id?: string | null
          sold_unit?: string
          tax_cents?: number
          tax_rate_bp?: number
          tenant_id?: string
          unit_price_cents?: number
          units_per_package_snapshot?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_appointment_product_id_fkey"
            columns: ["appointment_product_id"]
            isOneToOne: false
            referencedRelation: "appointment_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          attended_by_user_id: string | null
          branch_id: string
          closed_by: string | null
          created_at: string
          customer_id: string | null
          deleted_at: string | null
          discount_cents: number
          folio: number
          id: string
          paid_at: string | null
          species_group_id: string | null
          status: Database["public"]["Enums"]["sale_status"]
          subtotal_cents: number
          tax_cents: number
          tenant_id: string
          total_cents: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          attended_by_user_id?: string | null
          branch_id: string
          closed_by?: string | null
          created_at?: string
          customer_id?: string | null
          deleted_at?: string | null
          discount_cents?: number
          folio: number
          id?: string
          paid_at?: string | null
          species_group_id?: string | null
          status?: Database["public"]["Enums"]["sale_status"]
          subtotal_cents?: number
          tax_cents?: number
          tenant_id: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          attended_by_user_id?: string | null
          branch_id?: string
          closed_by?: string | null
          created_at?: string
          customer_id?: string | null
          deleted_at?: string | null
          discount_cents?: number
          folio?: number
          id?: string
          paid_at?: string | null
          species_group_id?: string | null
          status?: Database["public"]["Enums"]["sale_status"]
          subtotal_cents?: number
          tax_cents?: number
          tenant_id?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_species_group_fkey"
            columns: ["tenant_id", "species_group_id"]
            isOneToOne: false
            referencedRelation: "species_groups"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "sales_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          created_at: string
          deleted_at: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["service_kind"]
          name: string
          price_cents: number
          sat_product_code: string
          sat_unit_code: string
          tax_rate_bp: number
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          duration_minutes: number
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["service_kind"]
          name: string
          price_cents: number
          sat_product_code?: string
          sat_unit_code?: string
          tax_rate_bp: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["service_kind"]
          name?: string
          price_cents?: number
          sat_product_code?: string
          sat_unit_code?: string
          tax_rate_bp?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      share_links: {
        Row: {
          access_count: number
          created_at: string
          created_by: string
          customer_id: string | null
          deleted_at: string | null
          expires_at: string
          id: string
          last_accessed_at: string | null
          pet_id: string | null
          revoked_at: string | null
          scope: Database["public"]["Enums"]["share_link_scope"]
          tenant_id: string
          token_hash: string
          token_prefix: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          access_count?: number
          created_at?: string
          created_by: string
          customer_id?: string | null
          deleted_at?: string | null
          expires_at: string
          id?: string
          last_accessed_at?: string | null
          pet_id?: string | null
          revoked_at?: string | null
          scope: Database["public"]["Enums"]["share_link_scope"]
          tenant_id: string
          token_hash: string
          token_prefix: string
          updated_at?: string
        }
        Update: {
          access_count?: number
          created_at?: string
          created_by?: string
          customer_id?: string | null
          deleted_at?: string | null
          expires_at?: string
          id?: string
          last_accessed_at?: string | null
          pet_id?: string | null
          revoked_at?: string | null
          scope?: Database["public"]["Enums"]["share_link_scope"]
          tenant_id?: string
          token_hash?: string
          token_prefix?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "share_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_links_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      species: {
        Row: {
          created_at: string
          deleted_at: string | null
          group_id: string
          has_breeds: boolean
          id: string
          legacy_kind: Database["public"]["Enums"]["pet_species"]
          name: string
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          group_id: string
          has_breeds?: boolean
          id?: string
          legacy_kind?: Database["public"]["Enums"]["pet_species"]
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          group_id?: string
          has_breeds?: boolean
          id?: string
          legacy_kind?: Database["public"]["Enums"]["pet_species"]
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "species_group_fkey"
            columns: ["tenant_id", "group_id"]
            isOneToOne: false
            referencedRelation: "species_groups"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "species_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      species_groups: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "species_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          appointment_product_id: string | null
          branch_id: string
          created_at: string
          created_by: string
          hospital_medication_id: string | null
          id: string
          movement_type: Database["public"]["Enums"]["stock_movement_type"]
          product_id: string
          quantity: number
          reason: string | null
          sale_id: string | null
          tenant_id: string
        }
        ComputedFields: never
        Insert: {
          appointment_product_id?: string | null
          branch_id: string
          created_at?: string
          created_by: string
          hospital_medication_id?: string | null
          id?: string
          movement_type: Database["public"]["Enums"]["stock_movement_type"]
          product_id: string
          quantity: number
          reason?: string | null
          sale_id?: string | null
          tenant_id: string
        }
        Update: {
          appointment_product_id?: string | null
          branch_id?: string
          created_at?: string
          created_by?: string
          hospital_medication_id?: string | null
          id?: string
          movement_type?: Database["public"]["Enums"]["stock_movement_type"]
          product_id?: string
          quantity?: number
          reason?: string | null
          sale_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_appointment_product_id_fkey"
            columns: ["appointment_product_id"]
            isOneToOne: false
            referencedRelation: "appointment_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "stock_movements_hospital_medication_id_fkey"
            columns: ["hospital_medication_id"]
            isOneToOne: false
            referencedRelation: "hospital_medications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contact_name: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          supplier_type: Database["public"]["Enums"]["supplier_type"]
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          contact_name?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          supplier_type?: Database["public"]["Enums"]["supplier_type"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          contact_name?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          supplier_type?: Database["public"]["Enums"]["supplier_type"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      surgery_package_items: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          kind: Database["public"]["Enums"]["surgery_item_kind"]
          package_id: string
          position: number
          product_id: string | null
          quantity: number
          tax_rate_bp: number
          tenant_id: string
          unit: string
          unit_price_cents: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description: string
          id?: string
          kind: Database["public"]["Enums"]["surgery_item_kind"]
          package_id: string
          position?: number
          product_id?: string | null
          quantity?: number
          tax_rate_bp?: number
          tenant_id: string
          unit?: string
          unit_price_cents: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          kind?: Database["public"]["Enums"]["surgery_item_kind"]
          package_id?: string
          position?: number
          product_id?: string | null
          quantity?: number
          tax_rate_bp?: number
          tenant_id?: string
          unit?: string
          unit_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "surgery_package_items_package_fkey"
            columns: ["tenant_id", "package_id"]
            isOneToOne: false
            referencedRelation: "surgery_packages"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "surgery_package_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "surgery_package_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surgery_package_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      surgery_packages: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "surgery_packages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_invoicing_settings: {
        Row: {
          created_at: string
          csd_valid_until: string | null
          deleted_at: string | null
          id: string
          pac_organization_id: string | null
          series: string | null
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          csd_valid_until?: string | null
          deleted_at?: string | null
          id?: string
          pac_organization_id?: string | null
          series?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          csd_valid_until?: string | null
          deleted_at?: string | null
          id?: string
          pac_organization_id?: string | null
          series?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_invoicing_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_platform_info: {
        Row: {
          billing_period: Database["public"]["Enums"]["plan_billing_period"]
          created_at: string
          deleted_at: string | null
          id: string
          internal_notes: string | null
          is_demo: boolean
          plan_expires_at: string | null
          plan_id: string
          plan_name_snapshot: string
          public_reason: string | null
          public_reason_id: string | null
          status: Database["public"]["Enums"]["tenant_status"]
          status_reason: string | null
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          billing_period?: Database["public"]["Enums"]["plan_billing_period"]
          created_at?: string
          deleted_at?: string | null
          id?: string
          internal_notes?: string | null
          is_demo?: boolean
          plan_expires_at?: string | null
          plan_id: string
          plan_name_snapshot: string
          public_reason?: string | null
          public_reason_id?: string | null
          status?: Database["public"]["Enums"]["tenant_status"]
          status_reason?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          billing_period?: Database["public"]["Enums"]["plan_billing_period"]
          created_at?: string
          deleted_at?: string | null
          id?: string
          internal_notes?: string | null
          is_demo?: boolean
          plan_expires_at?: string | null
          plan_id?: string
          plan_name_snapshot?: string
          public_reason?: string | null
          public_reason_id?: string | null
          status?: Database["public"]["Enums"]["tenant_status"]
          status_reason?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_platform_info_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_platform_info_public_reason_id_fkey"
            columns: ["public_reason_id"]
            isOneToOne: false
            referencedRelation: "cancellation_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_platform_info_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          default_cfdi_use: string | null
          deleted_at: string | null
          id: string
          legal_name: string | null
          logo_path: string | null
          name: string
          postal_code: string | null
          rfc: string | null
          tax_regime_code: string | null
          timezone: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          default_cfdi_use?: string | null
          deleted_at?: string | null
          id?: string
          legal_name?: string | null
          logo_path?: string | null
          name: string
          postal_code?: string | null
          rfc?: string | null
          tax_regime_code?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_cfdi_use?: string | null
          deleted_at?: string | null
          id?: string
          legal_name?: string | null
          logo_path?: string | null
          name?: string
          postal_code?: string | null
          rfc?: string | null
          tax_regime_code?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      vaccinations: {
        Row: {
          applied_at: string
          applied_by_user_id: string | null
          appointment_id: string | null
          appointment_product_id: string | null
          batch_number: string | null
          created_at: string
          id: string
          next_due_date: string | null
          notes: string | null
          pet_id: string
          tenant_id: string
          updated_at: string
          vaccine_id: string
        }
        ComputedFields: never
        Insert: {
          applied_at?: string
          applied_by_user_id?: string | null
          appointment_id?: string | null
          appointment_product_id?: string | null
          batch_number?: string | null
          created_at?: string
          id?: string
          next_due_date?: string | null
          notes?: string | null
          pet_id: string
          tenant_id: string
          updated_at?: string
          vaccine_id: string
        }
        Update: {
          applied_at?: string
          applied_by_user_id?: string | null
          appointment_id?: string | null
          appointment_product_id?: string | null
          batch_number?: string | null
          created_at?: string
          id?: string
          next_due_date?: string | null
          notes?: string | null
          pet_id?: string
          tenant_id?: string
          updated_at?: string
          vaccine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vaccinations_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccinations_appointment_product_id_fkey"
            columns: ["appointment_product_id"]
            isOneToOne: false
            referencedRelation: "appointment_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccinations_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccinations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccinations_vaccine_id_fkey"
            columns: ["vaccine_id"]
            isOneToOne: false
            referencedRelation: "vaccines"
            referencedColumns: ["id"]
          },
        ]
      }
      vaccines: {
        Row: {
          created_at: string
          default_interval_days: number | null
          deleted_at: string | null
          id: string
          name: string
          species: Database["public"]["Enums"]["pet_species"] | null
          tenant_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          default_interval_days?: number | null
          deleted_at?: string | null
          id?: string
          name: string
          species?: Database["public"]["Enums"]["pet_species"] | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_interval_days?: number | null
          deleted_at?: string | null
          id?: string
          name?: string
          species?: Database["public"]["Enums"]["pet_species"] | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vaccines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      product_stock: {
        Row: {
          branch_id: string | null
          product_id: string | null
          stock: number | null
          tenant_id: string | null
        }
        ComputedFields: never
        Relationships: [
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_appointment_product: {
        Args: {
          p_appointment_id: string
          p_is_billable?: boolean
          p_product_id: string
          p_quantity: number
          p_unit?: string
        }
        Returns: string
      }
      add_hospital_note: {
        Args: {
          p_content?: string
          p_elimination?: string
          p_heart_rate_bpm?: number
          p_mood?: string
          p_mucous_color?: string
          p_noted_at?: string
          p_stay_id: string
          p_temperature_deci_c?: number
          p_weight_grams?: number
        }
        Returns: string
      }
      administer_hospital_medication: {
        Args: {
          p_is_billable?: boolean
          p_product_id: string
          p_quantity: number
          p_stay_id: string
          p_unit?: string
        }
        Returns: string
      }
      admit_pet: {
        Args: {
          p_pet_id: string
          p_rate_cents: number
          p_rate_mode: string
          p_reason?: string
          p_space_id: string
        }
        Returns: string
      }
      apply_surgery_lines: {
        Args: { p_appointment_id: string; p_lines: Json; p_package_id: string }
        Returns: number
      }
      bill_hospital_stay: {
        Args: { p_discount_cents?: number; p_payments: Json; p_stay_id: string }
        Returns: string
      }
      can_invoice: { Args: { p_tenant_id: string }; Returns: boolean }
      can_manage_invoicing: { Args: { p_tenant_id: string }; Returns: boolean }
      cancel_my_tenant: {
        Args: { p_comment?: string; p_tenant_id: string }
        Returns: undefined
      }
      cash_session_overview: {
        Args: { p_session_id: string }
        Returns: {
          card_cents: number
          cash_cents: number
          change_given_cents: number
          expected_cents: number
          income_cents: number
          openpay_cents: number
          outflow_cents: number
          transfer_cents: number
        }[]
      }
      checkout_appointment: {
        Args: {
          p_appointment_id: string
          p_discount_cents?: number
          p_payments: Json
          p_products?: Json
        }
        Returns: string
      }
      checkout_counter_sale: {
        Args: {
          p_branch_id: string
          p_customer_id: string
          p_discount_cents?: number
          p_payments: Json
          p_products: Json
        }
        Returns: string
      }
      checkout_quick_sale: {
        Args: {
          p_attended_by?: string
          p_branch_id: string
          p_discount_cents?: number
          p_payments: Json
          p_products: Json
          p_services: Json
          p_species_group_id?: string
        }
        Returns: string
      }
      claim_customer_link: { Args: { p_token: string }; Returns: Json }
      close_cash_session: {
        Args: { p_counted_cents: number; p_note?: string; p_session_id: string }
        Returns: {
          branch_id: string
          closed_at: string | null
          closed_by: string | null
          closing_note: string | null
          counted_cents: number | null
          created_at: string
          deleted_at: string | null
          difference_cents: number | null
          expected_cents: number | null
          id: string
          opened_at: string
          opened_by: string
          opening_float_cents: number
          opening_note: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_appointment: {
        Args: {
          p_branch_id: string
          p_customer_id: string
          p_employee_user_id: string
          p_ends_at: string
          p_kind: Database["public"]["Enums"]["service_kind"]
          p_notes: string
          p_pet_id: string
          p_services: Json
          p_starts_at: string
          p_tenant_id: string
        }
        Returns: {
          branch_id: string
          created_at: string
          created_by: string
          customer_id: string
          deleted_at: string | null
          employee_user_id: string
          ends_at: string
          id: string
          is_urgent: boolean
          is_walk_in: boolean
          kind: Database["public"]["Enums"]["service_kind"]
          notes: string | null
          pet_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_customer_with_pet: {
        Args: {
          p_cfdi_use?: string
          p_email?: string
          p_first_name: string
          p_last_name: string
          p_legal_name?: string
          p_notes?: string
          p_pet_birth_date?: string
          p_pet_birth_date_is_estimated?: boolean
          p_pet_breed?: string
          p_pet_breed_id?: string
          p_pet_grooming_notes?: string
          p_pet_is_sterilized?: boolean
          p_pet_medical_alerts?: string
          p_pet_name?: string
          p_pet_sex?: Database["public"]["Enums"]["pet_sex"]
          p_pet_species?: Database["public"]["Enums"]["pet_species"]
          p_pet_species_id?: string
          p_phone?: string
          p_postal_code?: string
          p_requires_invoice?: boolean
          p_rfc?: string
          p_tax_regime_code?: string
          p_tenant_id: string
        }
        Returns: Json
      }
      create_employee_membership: {
        Args: {
          p_birth_date: string
          p_branch_ids: string[]
          p_curp: string
          p_rfc: string
          p_role: Database["public"]["Enums"]["member_role"]
          p_tenant_id: string
          p_user_id: string
          p_voter_id_number: string
        }
        Returns: {
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["member_role"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_walk_in_appointment: {
        Args: {
          p_branch_id: string
          p_customer_id: string
          p_employee_user_id: string
          p_ends_at: string
          p_is_urgent: boolean
          p_kind: Database["public"]["Enums"]["service_kind"]
          p_notes: string
          p_pet_id: string
          p_services: Json
          p_starts_at: string
          p_tenant_id: string
        }
        Returns: {
          branch_id: string
          created_at: string
          created_by: string
          customer_id: string
          deleted_at: string | null
          employee_user_id: string
          ends_at: string
          id: string
          is_urgent: boolean
          is_walk_in: boolean
          kind: Database["public"]["Enums"]["service_kind"]
          notes: string | null
          pet_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      customer_account_overview: { Args: { p_user_id: string }; Returns: Json }
      customer_account_pet_detail: {
        Args: { p_pet_id: string; p_user_id: string }
        Returns: Json
      }
      customer_account_user_by_email: {
        Args: { p_email: string }
        Returns: {
          is_customer_account: boolean
          user_id: string
        }[]
      }
      delete_customer: { Args: { p_customer_id: string }; Returns: undefined }
      delete_employee: { Args: { p_membership_id: string }; Returns: undefined }
      delete_family: { Args: { p_family_id: string }; Returns: undefined }
      delete_pet: { Args: { p_pet_id: string }; Returns: undefined }
      discharge_pet: { Args: { p_stay_id: string }; Returns: undefined }
      list_unregistered_medications: {
        Args: Record<PropertyKey, never>
        Returns: {
          last_prescribed_at: string
          medication_name: string
          times_prescribed: number
        }[]
      }
      my_tenant_notices: {
        Args: Record<PropertyKey, never>
        Returns: {
          grace_ends_at: string
          notice: string
          plan_expires_at: string
          public_reason: string
          role: Database["public"]["Enums"]["member_role"]
          tenant_id: string
          tenant_name: string
        }[]
      }
      open_cash_session: {
        Args: { p_branch_id: string; p_note?: string; p_opening_float_cents: number }
        Returns: string
      }
      platform_add_admin: {
        Args: { p_user_id: string }
        Returns: {
          created_at: string
          deleted_at: string | null
          id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "platform_admins"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_create_plan: {
        Args: { p_name: string }
        Returns: {
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_create_reason: {
        Args: { p_label: string }
        Returns: {
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["cancellation_reason_kind"]
          label: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cancellation_reasons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_create_tenant: {
        Args: {
          p_branch_name: string
          p_is_demo?: boolean
          p_owner_full_name: string
          p_owner_phone: string
          p_tenant_name: string
          p_user_id: string
        }
        Returns: {
          created_at: string
          default_cfdi_use: string | null
          deleted_at: string | null
          id: string
          legal_name: string | null
          logo_path: string | null
          name: string
          postal_code: string | null
          rfc: string | null
          tax_regime_code: string | null
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_list_admins: {
        Args: Record<PropertyKey, never>
        Returns: {
          created_at: string
          email: string
          full_name: string
          user_id: string
        }[]
      }
      platform_list_feedback: {
        Args: Record<PropertyKey, never>
        Returns: {
          created_at: string
          id: string
          message: string
          screenshot_path: string
          tenant_id: string
          tenant_name: string
          user_email: string
          user_id: string
          user_name: string
        }[]
      }
      platform_list_tenants: {
        Args: Record<PropertyKey, never>
        Returns: {
          billing_period: Database["public"]["Enums"]["plan_billing_period"]
          created_at: string
          internal_notes: string
          is_demo: boolean
          name: string
          owner_email: string
          owner_name: string
          owner_phone: string
          owner_user_id: string
          plan: string
          plan_expires_at: string
          plan_id: string
          public_reason: string
          status: Database["public"]["Enums"]["tenant_status"]
          status_reason: string
          tenant_id: string
        }[]
      }
      platform_log_event: {
        Args: {
          p_details: Json
          p_event: string
          p_record_id: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      platform_remove_admin: {
        Args: { p_user_id: string }
        Returns: {
          created_at: string
          deleted_at: string | null
          id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "platform_admins"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_set_tenant_plan: {
        Args: {
          p_billing_period: Database["public"]["Enums"]["plan_billing_period"]
          p_plan_id: string
          p_tenant_id: string
        }
        Returns: {
          billing_period: Database["public"]["Enums"]["plan_billing_period"]
          created_at: string
          deleted_at: string | null
          id: string
          internal_notes: string | null
          is_demo: boolean
          plan_expires_at: string | null
          plan_id: string
          plan_name_snapshot: string
          public_reason: string | null
          public_reason_id: string | null
          status: Database["public"]["Enums"]["tenant_status"]
          status_reason: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_platform_info"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_set_tenant_status: {
        Args: {
          p_comment: string
          p_public_reason_id: string
          p_status: Database["public"]["Enums"]["tenant_status"]
          p_tenant_id: string
        }
        Returns: {
          billing_period: Database["public"]["Enums"]["plan_billing_period"]
          created_at: string
          deleted_at: string | null
          id: string
          internal_notes: string | null
          is_demo: boolean
          plan_expires_at: string | null
          plan_id: string
          plan_name_snapshot: string
          public_reason: string | null
          public_reason_id: string | null
          status: Database["public"]["Enums"]["tenant_status"]
          status_reason: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_platform_info"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_tenant_metrics: {
        Args: { p_tenant_id: string }
        Returns: {
          active_employees_count: number
          appointments_this_month_count: number
          branches_count: number
          customers_count: number
          last_access_at: string
          pets_count: number
        }[]
      }
      platform_update_notes: {
        Args: { p_notes: string; p_tenant_id: string }
        Returns: {
          billing_period: Database["public"]["Enums"]["plan_billing_period"]
          created_at: string
          deleted_at: string | null
          id: string
          internal_notes: string | null
          is_demo: boolean
          plan_expires_at: string | null
          plan_id: string
          plan_name_snapshot: string
          public_reason: string | null
          public_reason_id: string | null
          status: Database["public"]["Enums"]["tenant_status"]
          status_reason: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_platform_info"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_update_plan: {
        Args: { p_id: string; p_is_active: boolean; p_name: string }
        Returns: {
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_update_reason: {
        Args: { p_id: string; p_is_active: boolean; p_label: string }
        Returns: {
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["cancellation_reason_kind"]
          label: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cancellation_reasons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_appointment_product: { Args: { p_line_id: string }; Returns: undefined }
      remove_hospital_medication: {
        Args: { p_medication_id: string }
        Returns: undefined
      }
      remove_surgery_line: { Args: { p_line_id: string }; Returns: undefined }
      report_sales_by_species_group: {
        Args: { p_branch_id?: string; p_from: string; p_tenant_id: string; p_to: string }
        Returns: Json
      }
      report_sales_summary: {
        Args: { p_branch_id?: string; p_from: string; p_tenant_id: string; p_to: string }
        Returns: Json
      }
      report_staff_activity: {
        Args: { p_branch_id?: string; p_from: string; p_tenant_id: string; p_to: string }
        Returns: Json
      }
      report_top_items: {
        Args: {
          p_branch_id?: string
          p_from: string
          p_limit?: number
          p_tenant_id: string
          p_to: string
        }
        Returns: Json
      }
      reschedule_appointment: {
        Args: { p_appointment_id: string; p_ends_at: string; p_starts_at: string }
        Returns: {
          branch_id: string
          created_at: string
          created_by: string
          customer_id: string
          deleted_at: string | null
          employee_user_id: string
          ends_at: string
          id: string
          is_urgent: boolean
          is_walk_in: boolean
          kind: Database["public"]["Enums"]["service_kind"]
          notes: string | null
          pet_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_unregistered_medication: {
        Args: { p_medication_name: string; p_product_id?: string; p_tenant_id: string }
        Returns: number
      }
      revoke_user_sessions: { Args: { p_user_id: string }; Returns: number }
      save_family: {
        Args: {
          p_family_id: string
          p_holder_customer_id: string
          p_member_customer_ids: string[]
          p_name: string
          p_tenant_id: string
        }
        Returns: string
      }
      save_prescription: {
        Args: { p_appointment_id: string; p_items: Json }
        Returns: string
      }
      save_surgery_package: {
        Args: {
          p_items: Json
          p_name: string
          p_notes: string
          p_package_id: string
          p_tenant_id: string
        }
        Returns: string
      }
      search_customers: {
        Args: { p_tenant_id: string; p_term?: string }
        Returns: {
          cfdi_use: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          first_name: string
          id: string
          last_name: string
          legal_name: string | null
          notes: string | null
          phone: string | null
          postal_code: string | null
          requires_invoice: boolean
          rfc: string | null
          tax_regime_code: string | null
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "customers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_pets: {
        Args: { p_tenant_id: string; p_term?: string }
        Returns: {
          birth_date: string | null
          birth_date_is_estimated: boolean
          breed: string | null
          breed_id: string | null
          created_at: string
          customer_id: string
          deleted_at: string | null
          grooming_notes: string | null
          id: string
          is_sterilized: boolean
          medical_alerts: string | null
          name: string
          photo_path: string | null
          sex: Database["public"]["Enums"]["pet_sex"] | null
          species: Database["public"]["Enums"]["pet_species"]
          species_id: string | null
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "pets"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_products: {
        Args: { p_tenant_id: string; p_term?: string }
        Returns: {
          category_id: string | null
          cost_cents: number | null
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          min_stock: number
          name: string
          package_name: string | null
          price_cents: number
          sat_product_code: string
          sat_unit_code: string
          sku: string | null
          tax_rate_bp: number
          tenant_id: string
          unit_name: string | null
          unit_price_cents: number | null
          unit_sat_code: string | null
          units_per_package: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_product_presentation: {
        Args: {
          p_package_name?: string
          p_product_id: string
          p_unit_name?: string
          p_unit_price_cents?: number
          p_unit_sat_code?: string
          p_units_per_package: number
        }
        Returns: {
          category_id: string | null
          cost_cents: number | null
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          min_stock: number
          name: string
          package_name: string | null
          price_cents: number
          sat_product_code: string
          sat_unit_code: string
          sku: string | null
          tax_rate_bp: number
          tenant_id: string
          unit_name: string | null
          unit_price_cents: number | null
          unit_sat_code: string | null
          units_per_package: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_surgery_package_active: {
        Args: { p_is_active: boolean; p_package_id: string }
        Returns: undefined
      }
      set_tenant_logo: {
        Args: { p_logo_path: string; p_tenant_id: string }
        Returns: undefined
      }
      transfer_pet: {
        Args: { p_new_customer_id: string; p_pet_id: string }
        Returns: {
          birth_date: string | null
          birth_date_is_estimated: boolean
          breed: string | null
          breed_id: string | null
          created_at: string
          customer_id: string
          deleted_at: string | null
          grooming_notes: string | null
          id: string
          is_sterilized: boolean
          medical_alerts: string | null
          name: string
          photo_path: string | null
          sex: Database["public"]["Enums"]["pet_sex"] | null
          species: Database["public"]["Enums"]["pet_species"]
          species_id: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "pets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      unlink_customer_account: { Args: { p_customer_id: string }; Returns: undefined }
      update_tenant_fiscal_data: {
        Args: {
          p_legal_name: string
          p_postal_code: string
          p_rfc: string
          p_tax_regime_code: string
          p_tenant_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      appointment_status:
        "scheduled" | "in_progress" | "completed" | "cancelled" | "no_show"
      audit_action: "INSERT" | "UPDATE" | "DELETE"
      cancellation_reason_kind: "non_payment" | "customer_request" | "other"
      cash_movement_type: "withdrawal" | "expense" | "income"
      employee_document_type: "voter_id" | "address_proof" | "employment_contract"
      member_role: "owner" | "receptionist" | "groomer" | "vet"
      payment_method: "cash" | "card" | "transfer_spei" | "openpay"
      payment_status: "approved" | "simulated_approved"
      permission_module:
        "employees" | "inventory" | "invoicing" | "cash_register" | "reports"
      pet_sex: "male" | "female"
      pet_species: "dog" | "cat" | "other"
      plan_billing_period: "monthly" | "yearly" | "indefinite"
      sale_item_type: "service" | "product"
      sale_status: "open" | "paid" | "cancelled"
      service_kind: "grooming" | "veterinary"
      share_link_scope: "pet" | "customer"
      stock_movement_type:
        | "purchase"
        | "sale"
        | "sale_reversal"
        | "consumption"
        | "consumption_reversal"
        | "adjustment"
        | "loss"
      supplier_type: "medication" | "food" | "accessories" | "other"
      surgery_item_kind: "consumable" | "medication" | "fee"
      tenant_status: "active" | "suspended" | "closed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      appointment_status: [
        "scheduled",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
      ],
      audit_action: ["INSERT", "UPDATE", "DELETE"],
      cancellation_reason_kind: ["non_payment", "customer_request", "other"],
      cash_movement_type: ["withdrawal", "expense", "income"],
      employee_document_type: ["voter_id", "address_proof", "employment_contract"],
      member_role: ["owner", "receptionist", "groomer", "vet"],
      payment_method: ["cash", "card", "transfer_spei", "openpay"],
      payment_status: ["approved", "simulated_approved"],
      permission_module: [
        "employees",
        "inventory",
        "invoicing",
        "cash_register",
        "reports",
      ],
      pet_sex: ["male", "female"],
      pet_species: ["dog", "cat", "other"],
      plan_billing_period: ["monthly", "yearly", "indefinite"],
      sale_item_type: ["service", "product"],
      sale_status: ["open", "paid", "cancelled"],
      service_kind: ["grooming", "veterinary"],
      share_link_scope: ["pet", "customer"],
      stock_movement_type: [
        "purchase",
        "sale",
        "sale_reversal",
        "consumption",
        "consumption_reversal",
        "adjustment",
        "loss",
      ],
      supplier_type: ["medication", "food", "accessories", "other"],
      surgery_item_kind: ["consumable", "medication", "fee"],
      tenant_status: ["active", "suspended", "closed"],
    },
  },
} as const

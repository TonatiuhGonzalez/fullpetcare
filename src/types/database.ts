export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

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
          kind: Database["public"]["Enums"]["service_kind"]
          notes: string | null
          pet_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by: string
          customer_id: string
          deleted_at?: string | null
          employee_user_id: string
          ends_at: string
          id?: string
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
          name: string
          opening_hours: Json
          phone: string | null
          postal_code: string | null
          tenant_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          opening_hours?: Json
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
          name?: string
          opening_hours?: Json
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
      invoice_requests: {
        Row: {
          cfdi_use: string
          created_at: string
          deleted_at: string | null
          fiscal_uuid: string | null
          id: string
          legal_name: string
          payment_form_code: string
          payment_method_code: string
          postal_code: string
          rfc: string
          sale_id: string
          status: string
          tax_regime_code: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cfdi_use: string
          created_at?: string
          deleted_at?: string | null
          fiscal_uuid?: string | null
          id?: string
          legal_name: string
          payment_form_code: string
          payment_method_code: string
          postal_code: string
          rfc: string
          sale_id: string
          status?: string
          tax_regime_code: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cfdi_use?: string
          created_at?: string
          deleted_at?: string | null
          fiscal_uuid?: string | null
          id?: string
          legal_name?: string
          payment_form_code?: string
          payment_method_code?: string
          postal_code?: string
          rfc?: string
          sale_id?: string
          status?: string
          tax_regime_code?: string
          tenant_id?: string
          updated_at?: string
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
          reference: string | null
          sale_id: string
          status: Database["public"]["Enums"]["payment_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          paid_at?: string
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
          breed: string | null
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
          tenant_id: string
          updated_at: string
        }
        Insert: {
          birth_date?: string | null
          breed?: string | null
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
          tenant_id: string
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          breed?: string | null
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
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
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
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          deleted_at: string | null
          full_name: string
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name: string
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          appointment_id: string | null
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          item_type: Database["public"]["Enums"]["sale_item_type"]
          line_total_cents: number
          quantity: number
          sale_id: string
          service_id: string | null
          tax_cents: number
          tax_rate_bp: number
          tenant_id: string
          unit_price_cents: number
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description: string
          id?: string
          item_type?: Database["public"]["Enums"]["sale_item_type"]
          line_total_cents: number
          quantity?: number
          sale_id: string
          service_id?: string | null
          tax_cents: number
          tax_rate_bp: number
          tenant_id: string
          unit_price_cents: number
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          item_type?: Database["public"]["Enums"]["sale_item_type"]
          line_total_cents?: number
          quantity?: number
          sale_id?: string
          service_id?: string | null
          tax_cents?: number
          tax_rate_bp?: number
          tenant_id?: string
          unit_price_cents?: number
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
          branch_id: string
          closed_by: string | null
          created_at: string
          customer_id: string
          deleted_at: string | null
          discount_cents: number
          folio: number
          id: string
          paid_at: string | null
          status: Database["public"]["Enums"]["sale_status"]
          subtotal_cents: number
          tax_cents: number
          tenant_id: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          branch_id: string
          closed_by?: string | null
          created_at?: string
          customer_id: string
          deleted_at?: string | null
          discount_cents?: number
          folio: number
          id?: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["sale_status"]
          subtotal_cents?: number
          tax_cents?: number
          tenant_id: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string
          closed_by?: string | null
          created_at?: string
          customer_id?: string
          deleted_at?: string | null
          discount_cents?: number
          folio?: number
          id?: string
          paid_at?: string | null
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
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
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
          tax_rate_bp: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          duration_minutes: number
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["service_kind"]
          name: string
          price_cents: number
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
      tenants: {
        Row: {
          created_at: string
          default_cfdi_use: string | null
          deleted_at: string | null
          id: string
          legal_name: string | null
          name: string
          postal_code: string | null
          rfc: string | null
          tax_regime_code: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_cfdi_use?: string | null
          deleted_at?: string | null
          id?: string
          legal_name?: string | null
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
        Insert: {
          applied_at?: string
          applied_by_user_id?: string | null
          appointment_id?: string | null
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
      [_ in never]: never
    }
    Functions: {
      checkout_appointment: {
        Args: {
          p_appointment_id: string
          p_discount_cents?: number
          p_payments: Json
        }
        Returns: string
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
      reschedule_appointment: {
        Args: {
          p_appointment_id: string
          p_ends_at: string
          p_starts_at: string
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
    }
    Enums: {
      appointment_status:
        | "scheduled"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "no_show"
      audit_action: "INSERT" | "UPDATE" | "DELETE"
      member_role: "owner" | "receptionist" | "groomer" | "vet"
      payment_method: "cash" | "card" | "transfer_spei" | "openpay"
      payment_status: "approved" | "simulated_approved"
      pet_sex: "male" | "female"
      pet_species: "dog" | "cat" | "other"
      sale_item_type: "service"
      sale_status: "open" | "paid" | "cancelled"
      service_kind: "grooming" | "veterinary"
      share_link_scope: "pet" | "customer"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
      member_role: ["owner", "receptionist", "groomer", "vet"],
      payment_method: ["cash", "card", "transfer_spei", "openpay"],
      payment_status: ["approved", "simulated_approved"],
      pet_sex: ["male", "female"],
      pet_species: ["dog", "cat", "other"],
      sale_item_type: ["service"],
      sale_status: ["open", "paid", "cancelled"],
      service_kind: ["grooming", "veterinary"],
      share_link_scope: ["pet", "customer"],
    },
  },
} as const


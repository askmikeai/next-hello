variable "tenancy_ocid" {
  description = "OCI tenancy OCID"
  type        = string
}

variable "user_ocid" {
  description = "OCI user OCID"
  type        = string
}

variable "fingerprint" {
  description = "OCI API key fingerprint"
  type        = string
}

variable "private_key_path" {
  description = "Path to OCI API private key"
  type        = string
  default     = "~/.oci/oci_api_key.pem"
}

variable "region" {
  description = "OCI region"
  type        = string
  default     = "us-ashburn-1"
}

variable "compartment_ocid" {
  description = "OCI compartment OCID for all resources"
  type        = string
}

variable "kubernetes_version" {
  description = "OKE Kubernetes version"
  type        = string
  default     = "v1.30.1"
}

variable "node_shape" {
  description = "OKE node pool compute shape"
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "node_ocpus" {
  description = "OCPUs per node (Ampere A1 flex)"
  type        = number
  default     = 2
}

variable "node_memory_gb" {
  description = "Memory in GB per node"
  type        = number
  default     = 12
}

variable "node_count" {
  description = "Number of worker nodes"
  type        = number
  default     = 2
}

variable "ssh_public_key" {
  description = "SSH public key for node access"
  type        = string
  default     = ""
}

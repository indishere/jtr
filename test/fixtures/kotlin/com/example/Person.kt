package com.example

data class Person(val name: String, var age: Int) {
    fun birthday(): Int {
        age = age + 1
        return age
    }
}
